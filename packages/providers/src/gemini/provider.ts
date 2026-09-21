import { callGeminiGenerate, validateGeminiCredential, type GeminiClientConfig } from './client.js';
import { mapGeminiError } from './errors.js';
import { fromGeminiResponse, toGeminiRequest } from './mapper.js';
import type { LLMGenerationRequest, LLMProvider, LLMResponse } from '../types.js';

export type GeminiProviderConfig = GeminiClientConfig;

/**
 * A zero-cost, cloud-hosted counterpart to `createAnthropicProvider` —
 * Google's Generative Language API offers a genuine free tier (no billing
 * required) for its Gemini Flash models, replacing the local Ollama
 * adapter this codebase carried before: live testing showed a 7B local
 * model on modest hardware (no dedicated GPU) frequently couldn't
 * complete even simple tasks (malformed JSON output, requesting files that
 * don't exist, minutes-long generations), while a hosted Flash model needs
 * no local compute and no local resource contention with the rest of this
 * app. Implements the exact same `LLMProvider` shape as every other
 * adapter — Agent Runtime, Model Router, and the Orchestrator need no
 * changes to call this instead of/alongside Anthropic.
 */
export function createGeminiProvider(config: GeminiProviderConfig): LLMProvider {
  return {
    provider: 'gemini',

    async generate(request: LLMGenerationRequest): Promise<LLMResponse> {
      try {
        const response = await callGeminiGenerate(config, request.model, toGeminiRequest(request));
        return fromGeminiResponse(request.model, response);
      } catch (error) {
        throw mapGeminiError(error);
      }
    },

    async validateCredential(): Promise<void> {
      try {
        await validateGeminiCredential(config);
      } catch (error) {
        throw mapGeminiError(error);
      }
    }
  };
}
