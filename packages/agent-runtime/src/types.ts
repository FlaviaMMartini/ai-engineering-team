import type {
  AgentExecutionId,
  AgentRole,
  ContextPack,
  Task,
  TaskId,
  TokenBudget,
  TokenCost,
  TokenUsage,
  WorkflowExecutionId
} from '@aet/domain';
import type { RepositorySummary } from '@aet/context-engine';

/**
 * Structurally identical to @aet/providers' LLMMessage/LLMGenerationRequest/
 * LLMResponse/LLMProvider — deliberately NOT imported from there (agent-runtime
 * must never depend on @aet/providers, per the architectural boundary).
 * The same non-coupling pattern already used for TokenEstimator between
 * @aet/context-engine and @aet/token-intelligence: a concrete
 * `AnthropicProvider` instance satisfies this interface structurally, with
 * no compile-time dependency required. The composition root (a later
 * phase) is what actually passes a `createAnthropicProvider(...)` result
 * in as an `LLMExecutor`.
 */
export interface LLMExecutorMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type LLMExecutorFinishReason = 'stop' | 'max_tokens' | 'tool_use' | 'content_filter' | 'error' | 'unknown';

export interface LLMExecutorRequest {
  provider: string;
  model: string;
  systemPrompt: string | null;
  messages: readonly LLMExecutorMessage[];
  maxOutputTokens: number;
  temperature?: number;
}

export interface LLMExecutorResponse {
  provider: string;
  model: string;
  text: string;
  finishReason: LLMExecutorFinishReason;
  usage: TokenUsage;
  rawProviderUsage: Record<string, unknown> | null;
}

export interface LLMExecutor {
  readonly provider: string;
  generate(request: LLMExecutorRequest): Promise<LLMExecutorResponse>;
}

/** Looks up a concrete executor by provider name — the seam where Model Router's selection meets an actual (injected) executor. */
export interface LLMExecutorRegistry {
  get(provider: string): LLMExecutor | null;
}

export function createLLMExecutorRegistry(executors: readonly LLMExecutor[]): LLMExecutorRegistry {
  const byProvider = new Map(executors.map((executor) => [executor.provider, executor] as const));
  return {
    get(provider: string): LLMExecutor | null {
      return byProvider.get(provider) ?? null;
    }
  };
}

/**
 * Classification of an LLMExecutor failure, without importing
 * @aet/providers' error classes (which would violate the boundary). See
 * errors.ts's `classifyLLMError` — it duck-types the thrown error's
 * `.name`, since @aet/providers' normalized errors are Error subclasses
 * with predictable names, not a type this package can import directly.
 */
export type LLMExecutorErrorKind =
  | 'authentication'
  | 'invalid_request'
  | 'rate_limit'
  | 'context_limit'
  | 'provider_unavailable'
  | 'timeout'
  | 'no_eligible_model'
  | 'executor_not_configured'
  | 'invalid_output'
  | 'file_write_rejected'
  | 'unknown';

export interface AgentExecutionError {
  kind: LLMExecutorErrorKind;
  message: string;
  /** Whether the Workflow Engine/Orchestrator could reasonably retry this — this package never retries itself. */
  retryable: boolean;
  retryAfterSeconds: number | null;
}

export type AgentOutcomeStatus = 'success' | 'failure' | 'retryable_failure';

export interface AgentExecutionContext {
  agentExecutionId: AgentExecutionId;
  taskId: TaskId;
  workflowExecutionId: WorkflowExecutionId;
  retryNumber: number;
}

/** Common to every agent's input — role-specific inputs (see agents/*.ts) extend this. */
export interface AgentInput {
  task: Task;
  contextPack: ContextPack;
  repositorySummary: RepositorySummary;
  executionContext: AgentExecutionContext;
  tokenBudget: TokenBudget;
}

/**
 * What the Developer raises when its given context is insufficient — NOT
 * @aet/domain's `ContextExpansionRequest`. That domain type requires a
 * `decision` (APPROVED/PARTIAL/DENIED) and an `id`, which don't exist yet
 * at the moment the Developer asks; there is no "pending" decision value
 * in the domain type, and fabricating one (or worse, defaulting to
 * "APPROVED") would be exactly the hidden approval policy this phase is
 * explicitly told not to invent. Turning this proposal into a real,
 * decided `ContextExpansionRequest` is the Orchestrator's job in a later
 * phase, once Context Engine + Token Intelligence have actually evaluated it.
 */
export interface ContextExpansionProposal {
  reason: string;
  filesRequested: readonly string[];
  estimatedAdditionalTokens: number | null;
}

/**
 * `output` is null on failure. `usage`/`cost` reflect this one call (or
 * null cost when the selected model had no pricing attached) — Token
 * Intelligence's variance/retry-overhead/budget aggregation is a
 * task-level concern for the Orchestrator to compute from a sequence of
 * these, not duplicated here.
 */
export interface AgentResult<TOutput> {
  status: AgentOutcomeStatus;
  output: TOutput | null;
  provider: string | null;
  model: string | null;
  usage: TokenUsage;
  /** The executor's raw provider usage object, exactly as returned, or null if no response was ever received (e.g. model selection failed before any call was made). Never fabricated — see execution.ts's propagation of LLMExecutorResponse.rawProviderUsage. */
  rawProviderUsage: Record<string, unknown> | null;
  cost: TokenCost | null;
  startedAt: string;
  completedAt: string;
  error: AgentExecutionError | null;
}

export interface Agent<TInput extends AgentInput, TOutput> {
  readonly role: AgentRole;
  execute(input: TInput): Promise<AgentResult<TOutput>>;
}
