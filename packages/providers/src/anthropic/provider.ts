import { createAnthropicClient, type AnthropicClientConfig } from './client.js';
import { mapAnthropicError } from './errors.js';
import { fromAnthropicResponse, toAnthropicRequest } from './mapper.js';
import type { LLMGenerationRequest, LLMProvider, LLMResponse } from '../types.js';

export type AnthropicProviderConfig = AnthropicClientConfig;

/**
 * Used only by `validateCredential()` (Phase 19/BYOK) — never for a real
 * agent call. Any current model name works here since the call never
 * generates output tokens; kept as the same id the rest of this codebase's
 * model catalog already uses (see apps/api's composition root) rather than
 * inventing a second one.
 */
const CREDENTIAL_VALIDATION_MODEL = 'claude-sonnet-5';

/**
 * The only place `@anthropic-ai/sdk` may be imported (see errors.ts,
 * client.ts, mapper.ts — all under this `anthropic/` directory). Executes
 * exactly once per `generate()` call: no retry loop, no fallback logic.
 * If the call fails, it throws one of this package's normalized errors —
 * deciding whether to retry, fall back to another model, or give up is the
 * orchestration layer's job (Phase 8+), never this adapter's.
 */
export function createAnthropicProvider(config: AnthropicProviderConfig): LLMProvider {
  return {
    provider: 'anthropic',

    async generate(request: LLMGenerationRequest): Promise<LLMResponse> {
      const client = await createAnthropicClient(config);
      const params = toAnthropicRequest(request);

      try {
        const message = await client.messages.create(params);
        return fromAnthropicResponse(message);
      } catch (error) {
        throw mapAnthropicError(error);
      }
    },

    /**
     * Uses the Messages Token Counting endpoint rather than `generate()`:
     * it authenticates the credential exactly like a real call would (an
     * invalid key still throws `AuthenticationError`), but never produces
     * output tokens, so validating a credential never costs a generation.
     */
    async validateCredential(): Promise<void> {
      const client = await createAnthropicClient(config);
      try {
        await client.beta.messages.countTokens({
          model: CREDENTIAL_VALIDATION_MODEL,
          messages: [{ role: 'user', content: 'ping' }]
        });
      } catch (error) {
        throw mapAnthropicError(error);
      }
    }
  };
}
