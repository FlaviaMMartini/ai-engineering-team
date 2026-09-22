import type { TokenUsage } from '@aet/domain';
import type { LLMFinishReason, LLMGenerationRequest, LLMResponse } from '../types.js';
import type { GeminiContent, GeminiGenerateRequest, GeminiGenerateResponse } from './client.js';

function toGeminiContents(request: LLMGenerationRequest): readonly GeminiContent[] {
  return request.messages.map((message) => ({
    // Gemini calls the model's own turn "model", not "assistant" — everything else in this
    // adapter still speaks this package's provider-agnostic 'user' | 'assistant' shape.
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }));
}

/**
 * No tool-use support here — same scope decision the Ollama adapter made
 * for its first version; a request with `tools` simply omits them rather
 * than failing.
 *
 * `responseMimeType: 'application/json'` is set unconditionally: every
 * agent role in this codebase (Architect/Developer/QA) only ever asks for
 * structured JSON — there is no free-text use case for this adapter — and
 * without it the model is free to respond with plain prose instead (caught
 * live: the Developer once answered with a natural-language summary of
 * "here's what I built" instead of the JSON payload itself, exhausting its
 * whole output-token budget before ever emitting a single `{`). This is
 * Gemini's own native JSON-mode constraint, enforced by the API itself —
 * far more reliable than a prompt instruction alone, which a model can
 * simply ignore.
 *
 * Disabling "thinking" tokens matters because they otherwise draw from the
 * SAME `maxOutputTokens` ceiling as the visible response — caught live via a
 * diagnostic that logs `finishReason` on every parse failure: the
 * Developer's call reported `finishReason: "max_tokens"` after producing
 * only ~1.3KB of visible text against an 8000-token (~32KB) budget, meaning
 * the model spent nearly the entire budget thinking and had almost nothing
 * left to actually answer with. Every agent role here wants a single
 * deterministic structured document, not a visible reasoning trace, so
 * thinking is pure overhead for this codebase's use case.
 *
 * The *shape* of that config is NOT uniform across Gemini model
 * generations, and sending the wrong one is a hard `400 INVALID_ARGUMENT` —
 * not silently ignored — caught live when the automatic same-provider
 * fallback (see composition-root.ts's `buildGeminiFallbackCatalogEntry`)
 * fell through to `gemini-3.5-flash-lite` and every one of its calls failed
 * outright: `gemini-3.6-flash` accepts the older numeric `thinkingBudget`,
 * while `gemini-3.5-flash-lite` only exposes the newer enum `thinkingLevel`
 * ('MINIMAL'/'MEDIUM'/'HIGH') and rejects `thinkingBudget` entirely.
 * `minimalThinkingConfigFor` below is the one place that distinction lives —
 * add a new Gemini model's own correct shape here, never assume the
 * previous model's shape still applies.
 */
function minimalThinkingConfigFor(model: string): { thinkingBudget: number } | { thinkingLevel: 'MINIMAL' } {
  if (model === 'gemini-3.5-flash-lite') {
    return { thinkingLevel: 'MINIMAL' };
  }
  return { thinkingBudget: 0 };
}

export function toGeminiRequest(request: LLMGenerationRequest): GeminiGenerateRequest {
  return {
    contents: toGeminiContents(request),
    ...(request.systemPrompt !== null ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } } : {}),
    generationConfig: {
      maxOutputTokens: request.maxOutputTokens,
      responseMimeType: 'application/json',
      thinkingConfig: minimalThinkingConfigFor(request.model),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {})
    }
  };
}

function toFinishReason(reason: string | undefined): LLMFinishReason {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
    case 'RECITATION':
    case 'PROHIBITED_CONTENT':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

/**
 * `usageMetadata` carries Gemini's own real, provider-reported token
 * counts — never estimated here. No cache-token concept is exposed by this
 * API today, so those two `TokenUsage` fields are always null (matching
 * `TokenUsage`'s "null when the provider doesn't expose it" convention —
 * never fabricated as zero).
 */
export function fromGeminiResponse(model: string, response: GeminiGenerateResponse): LLMResponse {
  const candidate = response.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text).join('') ?? '';

  const inputTokens = response.usageMetadata?.promptTokenCount ?? null;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? null;
  const totalTokens = response.usageMetadata?.totalTokenCount ?? null;
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    cacheCreationTokens: null,
    cacheReadTokens: null,
    totalTokens: totalTokens ?? (inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0))
  };

  return {
    provider: 'gemini',
    model,
    text,
    finishReason: toFinishReason(candidate?.finishReason),
    usage,
    rawProviderUsage:
      response.usageMetadata === undefined
        ? null
        : {
            promptTokenCount: response.usageMetadata.promptTokenCount ?? null,
            candidatesTokenCount: response.usageMetadata.candidatesTokenCount ?? null,
            totalTokenCount: response.usageMetadata.totalTokenCount ?? null
          }
  };
}
