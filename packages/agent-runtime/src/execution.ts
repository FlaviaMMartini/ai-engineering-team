import { appendFileSync } from 'node:fs';
import { calculateCost, ZERO_TOKEN_USAGE, type AgentRole, type ModelPricing, type TokenBudget, type TokenCost, type TokenUsage } from '@aet/domain';
import { NoEligibleModelError, type ModelDescriptor, type ModelRouter } from '@aet/model-router';
import type { TokenEstimator } from '@aet/token-intelligence';
import { classifyLLMError, makeAgentExecutionError } from './errors.js';
import { buildModelSelectionRequest } from './model-selection.js';
import type { AgentExecutionError, AgentResult, LLMExecutorRegistry } from './types.js';

export interface InvokeLLMDependencies {
  modelRouter: ModelRouter;
  executorRegistry: LLMExecutorRegistry;
  tokenEstimator: TokenEstimator;
}

export interface InvokeLLMParams<TOutput> {
  agentRole: AgentRole;
  systemPrompt: string;
  userMessage: string;
  expectedOutputTokens: number;
  tokenBudget: TokenBudget;
  /** Throws on malformed output — invokeLLM turns that into a retryable_failure rather than propagating the exception. */
  parseOutput: (text: string) => TOutput;
}

/**
 * LLMs commonly wrap JSON in a ```json fence, or add a stray sentence
 * before/after it, even when explicitly asked to respond with ONLY JSON.
 * Three fallbacks, in order: (1) a fenced block anywhere in the text —
 * unanchored, so leading/trailing prose around the fence no longer breaks
 * this the way an exact-match anchor would; (2) if there's no fence at
 * all, the outermost `{...}`/`[...]` span, in case the model added prose
 * without a fence; (3) the trimmed text as-is. This never repairs
 * malformed JSON itself — `JSON.parse` still throws (and invokeLLM still
 * classifies that as a retryable failure) if the extracted span isn't
 * valid JSON.
 */
/**
 * Repairs one specific, observed small-model mistake: writing a
 * multi-line string value (most often a "content" field carrying a whole
 * file's HTML/CSS/JS) as a JavaScript template literal (`...`) instead of a
 * properly JSON-escaped string, which JSON.parse always rejects. Re-encodes
 * the raw text between a `"key": ` ... `` span as a proper JSON string via
 * JSON.stringify, leaving everything else untouched. Only ever called as a
 * fallback AFTER JSON.parse has already failed once — a model that already
 * produces valid JSON never pays for this. Heuristic, not a parser: a
 * backtick occurring inside the model's own generated content (e.g.
 * generated JS that itself uses template literals) can still defeat it.
 */
function repairTemplateLiteralStrings(text: string): string {
  return text.replace(/("(?:[^"\\]|\\.)*"\s*:\s*)`([\s\S]*?)`(?=\s*[,\]}])/g, (_match, keyPart: string, body: string) => {
    return `${keyPart}${JSON.stringify(body)}`;
  });
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();

  const fenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  if (fenceMatch?.[1] !== undefined) return fenceMatch[1];

  const firstBracket = trimmed.search(/[[{]/);
  const lastBracket = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }

  return trimmed;
}

/**
 * `AgentExecutionError.retryable` (set by `classifyLLMError`) was defined
 * for exactly this — transient provider hiccups (rate limits, momentary
 * "provider unavailable" 503s, timeouts) that a real team would just retry,
 * not treat as a reason to fail the whole task — but nothing ever read the
 * flag: every failed LLM call propagated straight to the caller as a
 * one-shot failure. A live Gemini 503 ("This model is currently
 * experiencing high demand... Please try again later") made this visible:
 * Google's own message says to retry, and the app never did. Fixed transparently
 * here, the one place every agent role's LLM call already passes through,
 * rather than duplicating retry logic in each of the Architect/Developer/QA
 * call sites in orchestrator.ts.
 */
const RETRY_BACKOFF_MS = [2000, 5000];
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
/**
 * A separate, larger wait-time BUDGET (not an attempt count) for rate-limit
 * errors specifically. Every other retryable kind (provider_unavailable,
 * timeout, invalid_output) is a guess at how long to wait — Google never
 * says how long a 503 or a malformed-output roll of the dice will take to
 * clear, so a small fixed attempt count is the honest limit of what backing
 * off blindly can justify. A rate limit is different: Gemini's own
 * `google.rpc.RetryInfo` tells us precisely how many milliseconds remain
 * (see gemini/client.ts's `parseRetryDelaySeconds`), so the right question
 * isn't "how many tries" but "is the wait itself still reasonable" — caught
 * live when a call failed with 282ms left on the clock and the fixed
 * 3-attempt cap gave up one step before it would have cleared.
 */
const MAX_RATE_LIMIT_WAIT_MS = 90_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attemptIndex: number, retryAfterSeconds: number | null): number {
  return Math.min(retryAfterSeconds !== null ? retryAfterSeconds * 1000 : (RETRY_BACKOFF_MS[attemptIndex] ?? MAX_RETRY_DELAY_MS), MAX_RETRY_DELAY_MS);
}

/**
 * Best-effort dump of a response this codebase couldn't parse as the
 * expected structured output, to its own file (never console/stdout) so a
 * long, embedded-newline-laden raw response can never interleave with
 * concurrent pino request logs on the same stream. Temporary diagnostic for
 * the unparseable-JSON investigation; remove once root-caused.
 */
function logUnparseableResponse(agentRole: AgentRole, provider: string, model: string, message: string, responseText: string): void {
  try {
    appendFileSync(
      'invoke-llm-parse-failures.log',
      `\n===== ${new Date().toISOString()} ${agentRole} (${provider}/${model}): ${message} =====\n${responseText}\n===== end =====\n`,
      'utf8'
    );
  } catch {
    // Best-effort diagnostic only — never let a logging failure mask the real error below.
  }
}

function buildCost(usage: TokenUsage, pricing: ModelPricing | null, estimatedCost: number | null): TokenCost | null {
  if (pricing === null) return null;
  return {
    estimatedCost,
    calculatedCost: calculateCost(usage, pricing),
    pricingVersion: pricing.version,
    currency: pricing.currency
  };
}

function failure<TOutput>(
  startedAt: string,
  provider: string | null,
  model: string | null,
  usage: TokenUsage,
  rawProviderUsage: Record<string, unknown> | null,
  cost: TokenCost | null,
  error: AgentExecutionError
): AgentResult<TOutput> {
  return {
    status: error.retryable ? 'retryable_failure' : 'failure',
    output: null,
    provider,
    model,
    usage,
    rawProviderUsage,
    cost,
    startedAt,
    completedAt: new Date().toISOString(),
    error
  };
}

/**
 * Runs the full network-call + retry + parse pipeline against ONE already-
 * selected candidate. Split out of `invokeLLM` so that function can try each
 * of Model Router's ranked candidates in turn — see `invokeLLM`'s own doc
 * comment for why.
 */
async function invokeCandidate<TOutput>(
  deps: InvokeLLMDependencies,
  params: InvokeLLMParams<TOutput>,
  candidate: ModelDescriptor,
  estimatedInputTokens: number,
  startedAt: string
): Promise<AgentResult<TOutput>> {
  const selectedProvider = candidate.provider;
  const selectedModel = candidate.model;
  const selectedPricing = candidate.pricing;

  const executor = deps.executorRegistry.get(selectedProvider);
  if (executor === null) {
    return failure(
      startedAt,
      selectedProvider,
      selectedModel,
      ZERO_TOKEN_USAGE,
      null,
      null,
      makeAgentExecutionError('executor_not_configured', `No LLMExecutor registered for provider "${selectedProvider}"`)
    );
  }

  const preCallUsage: TokenUsage = {
    inputTokens: estimatedInputTokens,
    outputTokens: params.expectedOutputTokens,
    cacheCreationTokens: null,
    cacheReadTokens: null,
    totalTokens: estimatedInputTokens + params.expectedOutputTokens
  };
  const estimatedCost = selectedPricing !== null ? calculateCost(preCallUsage, selectedPricing) : null;

  // A single retry loop spans BOTH the network call and the parse step. An LLM's output is
  // non-deterministic — a malformed-JSON response (marked `retryable: true` by makeAgentExecutionError
  // below, exactly like a transient network error) is, in practice, just as likely to succeed on a
  // fresh attempt as a 503 is. Retrying only the network call and giving up permanently on the very
  // first parse failure (the previous behavior) meant a single bad roll of the dice failed the whole
  // task even though the flag to retry it already existed and was already being set — nothing ever
  // read it. Observed live: the Developer's schema (raw source code embedded as escaped JSON string
  // values) is the hardest of the three roles for a model to get right every time, even a capable one.
  let rateLimitWaitSoFarMs = 0;
  for (let attempt = 0; ; attempt++) {
    let responseText: string;
    let responseUsage: TokenUsage;
    let responseRawProviderUsage: Record<string, unknown> | null;
    let responseFinishReason: string;
    try {
      const response = await executor.generate({
        provider: selectedProvider,
        model: selectedModel,
        systemPrompt: params.systemPrompt,
        messages: [{ role: 'user', content: params.userMessage }],
        maxOutputTokens: params.expectedOutputTokens
      });
      responseText = response.text;
      responseUsage = response.usage;
      responseRawProviderUsage = response.rawProviderUsage;
      responseFinishReason = response.finishReason;
    } catch (error) {
      const classified = classifyLLMError(error);
      if (!classified.retryable) {
        return failure(startedAt, selectedProvider, selectedModel, ZERO_TOKEN_USAGE, null, buildCost(ZERO_TOKEN_USAGE, selectedPricing, estimatedCost), classified);
      }
      if (classified.kind === 'rate_limit') {
        const delayMs = backoffDelayMs(attempt, classified.retryAfterSeconds);
        if (rateLimitWaitSoFarMs + delayMs > MAX_RATE_LIMIT_WAIT_MS) {
          return failure(startedAt, selectedProvider, selectedModel, ZERO_TOKEN_USAGE, null, buildCost(ZERO_TOKEN_USAGE, selectedPricing, estimatedCost), classified);
        }
        rateLimitWaitSoFarMs += delayMs;
        await sleep(delayMs);
        continue;
      }
      if (attempt >= MAX_ATTEMPTS - 1) {
        return failure(startedAt, selectedProvider, selectedModel, ZERO_TOKEN_USAGE, null, buildCost(ZERO_TOKEN_USAGE, selectedPricing, estimatedCost), classified);
      }
      await sleep(backoffDelayMs(attempt, classified.retryAfterSeconds));
      continue;
    }

    const strippedResponseText = stripCodeFence(responseText);
    try {
      const output = params.parseOutput(strippedResponseText);
      return {
        status: 'success',
        output,
        provider: selectedProvider,
        model: selectedModel,
        usage: responseUsage,
        rawProviderUsage: responseRawProviderUsage,
        cost: buildCost(responseUsage, selectedPricing, estimatedCost),
        startedAt,
        completedAt: new Date().toISOString(),
        error: null
      };
    } catch (firstError) {
      try {
        const output = params.parseOutput(repairTemplateLiteralStrings(strippedResponseText));
        return {
          status: 'success',
          output,
          provider: selectedProvider,
          model: selectedModel,
          usage: responseUsage,
          rawProviderUsage: responseRawProviderUsage,
          cost: buildCost(responseUsage, selectedPricing, estimatedCost),
          startedAt,
          completedAt: new Date().toISOString(),
          error: null
        };
      } catch {
        const message = firstError instanceof Error ? firstError.message : 'Failed to parse structured output';
        logUnparseableResponse(
          params.agentRole,
          selectedProvider,
          selectedModel,
          `${message} [finishReason=${responseFinishReason}, length=${responseText.length}]`,
          responseText
        );
        const classified = makeAgentExecutionError('invalid_output', message, true);
        if (attempt >= MAX_ATTEMPTS - 1) {
          return failure(startedAt, selectedProvider, selectedModel, responseUsage, responseRawProviderUsage, buildCost(responseUsage, selectedPricing, estimatedCost), classified);
        }
        await sleep(backoffDelayMs(attempt, null));
      }
    }
  }
}

/**
 * The shared pipeline every agent uses: estimate input tokens -> ask Model
 * Router for a candidate -> look up the injected executor for that
 * provider -> call it -> parse structured output. Model Router's own
 * capability/tier/pricing logic is never duplicated here — this only wires
 * the pieces together and classifies what happened.
 *
 * Falls through Model Router's own ranked `fallbacks` list (see
 * model-router's `ModelSelectionResult` doc comment: "in case the caller's
 * actual provider call fails and it wants to retry with the next one —
 * model-router never performs that retry itself") when the top candidate's
 * own retry budget (`invokeCandidate` above) is exhausted. This never tries
 * a provider the project hasn't actually connected — `fallbacks` only ever
 * contains candidates from the SAME per-project catalog the top pick came
 * from (composition-root.ts builds that catalog from connected providers
 * only), so a project with only Gemini connected has an empty fallback
 * list and behaves exactly as before. A connected-but-costlier provider
 * (e.g. Anthropic) only ever becomes a candidate here because the user
 * explicitly connected it themselves — this never silently starts spending
 * money a project didn't already opt into.
 */
export async function invokeLLM<TOutput>(
  deps: InvokeLLMDependencies,
  params: InvokeLLMParams<TOutput>
): Promise<AgentResult<TOutput>> {
  const startedAt = new Date().toISOString();
  const estimatedInputTokens = deps.tokenEstimator(params.systemPrompt) + deps.tokenEstimator(params.userMessage);

  let candidates: readonly ModelDescriptor[];
  try {
    const selectionRequest = buildModelSelectionRequest(
      params.agentRole,
      estimatedInputTokens,
      params.expectedOutputTokens,
      params.tokenBudget
    );
    const selection = deps.modelRouter.selectModel(selectionRequest);
    candidates = [selection.selected, ...selection.fallbacks];
  } catch (error) {
    const message = error instanceof NoEligibleModelError ? error.message : 'Model selection failed';
    return failure(startedAt, null, null, ZERO_TOKEN_USAGE, null, null, makeAgentExecutionError('no_eligible_model', message));
  }

  let lastResult: AgentResult<TOutput> | null = null;
  for (const candidate of candidates) {
    const result = await invokeCandidate(deps, params, candidate, estimatedInputTokens, startedAt);
    if (result.status === 'success') return result;
    lastResult = result;
  }
  // Unreachable in practice: `candidates` always has at least one element (selectModel throws
  // NoEligibleModelError, handled above, whenever it would otherwise return zero).
  return lastResult as AgentResult<TOutput>;
}
