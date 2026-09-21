import type { TokenUsage } from '@aet/domain';

/**
 * GAP FOUND (reported, not silently patched — see Phase 7 report):
 * @aet/domain's `LLMRequest` is a call-RECORD type (id, taskId,
 * agentExecutionId, provider, providerModel, purpose, timestamps, plus
 * OUTPUT fields normalizedUsage/providerReportedUsage/cost that only make
 * sense once a call has completed). It has no messages, system prompt,
 * max-tokens, temperature, or tools — there is nothing in domain shaped
 * like "the parameters to actually make one generate() call". So this
 * package defines that shape itself, under a different name
 * (`LLMGenerationRequest`) to avoid any confusion with domain's
 * `LLMRequest`. The two are complementary: agent-runtime/orchestrator will
 * construct an `LLMGenerationRequest` to call `LLMProvider.generate()`,
 * then build a domain `LLMRequest` record from the `LLMResponse` that
 * comes back (usage -> normalizedUsage, rawProviderUsage ->
 * providerReportedUsage). Nothing here duplicates domain's `TokenUsage`,
 * which is reused verbatim on `LLMResponse.usage`.
 */
export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Request-side shape only. Translating a *response* `tool_use` block back
 * into a follow-up tool-result turn (the full interactive tool-use loop)
 * is NOT implemented in this phase — see the Anthropic provider's own
 * doc comment for why, and the Phase 7 report's "future extension" note.
 */
export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
}

export interface LLMGenerationRequest {
  provider: string;
  model: string;
  systemPrompt: string | null;
  messages: readonly LLMMessage[];
  maxOutputTokens: number;
  temperature?: number;
  tools?: readonly LLMToolDefinition[];
  metadata?: Record<string, unknown>;
}

export type LLMFinishReason = 'stop' | 'max_tokens' | 'tool_use' | 'content_filter' | 'error' | 'unknown';

/**
 * The normalized shape the rest of the application consumes — nobody
 * outside this package ever sees an `@anthropic-ai/sdk` (or a future
 * OpenAI SDK) type; Gemini's own REST shapes stay confined to
 * gemini/client.ts.
 */
export interface LLMResponse {
  provider: string;
  model: string;
  text: string;
  finishReason: LLMFinishReason;
  /** @aet/domain's TokenUsage, reused directly — never redefined. */
  usage: TokenUsage;
  /** The provider's raw usage object, exactly as returned, or null if none was returned. Never fabricated. */
  rawProviderUsage: Record<string, unknown> | null;
  requestMetadata?: Record<string, unknown>;
}

/**
 * Provider-agnostic on purpose — no vendor name appears here. Concrete
 * adapters (AnthropicProvider, GeminiProvider, and later OpenAI) each
 * implement this exact shape.
 *
 * `validateCredential` (Phase 19/BYOK) is optional because not every
 * provider necessarily has a cheap, generation-free way to confirm a
 * credential works — an adapter that omits it simply can't be validated
 * without a real `generate()` call, which callers (see @aet/credentials)
 * must not assume. When present, it resolves if the credential this
 * provider was constructed with is currently accepted by the vendor, and
 * rejects (with one of this package's normalized `LLMProviderError`
 * subclasses) otherwise — never a boolean, so the caller gets the same
 * typed error shape `generate()` already produces.
 */
export interface LLMProvider {
  readonly provider: string;
  generate(request: LLMGenerationRequest): Promise<LLMResponse>;
  validateCredential?(): Promise<void>;
}

/**
 * Indirection so a real secret store (persistence's future
 * `ProviderCredential` + encryption, per SECURITY.md) can be plugged in
 * later without changing any adapter's constructor signature. For now,
 * callers typically supply `createStaticCredentialProvider(apiKey)`.
 */
export interface CredentialProvider {
  getApiKey(): string | Promise<string>;
}

export function createStaticCredentialProvider(apiKey: string): CredentialProvider {
  return { getApiKey: () => apiKey };
}
