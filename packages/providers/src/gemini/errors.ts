import {
  LLMAuthenticationError,
  LLMContextLimitExceededError,
  LLMInvalidRequestError,
  LLMProviderError,
  LLMProviderUnavailableError,
  LLMRateLimitError,
  LLMTimeoutError,
  LLMUnknownProviderError
} from '../errors.js';

const PROVIDER_NAME = 'gemini';

/**
 * Carries the HTTP status and the vendor's own `error.message` text (never
 * the full response body, which could in principle echo request content) —
 * Google's Generative Language API returns a real, human-readable
 * explanation there (e.g. quota/billing issues), same as Anthropic's SDK
 * already surfaces via `APIError.message`. `retryDelaySeconds` carries
 * Google's own machine-readable `google.rpc.RetryInfo` hint on a 429 (see
 * client.ts's `parseRetryDelaySeconds`) — null for every other status, or
 * when a 429 body didn't include one.
 */
export class GeminiHttpError extends Error {
  readonly status: number;
  readonly retryDelaySeconds: number | null;

  constructor(status: number, message: string, retryDelaySeconds: number | null = null) {
    super(`Gemini returned HTTP ${status}: ${message}`);
    this.name = 'GeminiHttpError';
    this.status = status;
    this.retryDelaySeconds = retryDelaySeconds;
  }
}

function looksLikeInvalidApiKey(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('api key not valid') || lower.includes('api_key_invalid') || lower.includes('api key expired');
}

function looksLikeContextLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('exceeds the maximum') || lower.includes('token count exceeds') || lower.includes('too long');
}

/**
 * Google's Generative Language API doesn't map cleanly onto HTTP status
 * alone: an invalid API key comes back as HTTP 400 (not 401/403) with
 * `status: "INVALID_ARGUMENT"` and a message naming the key — the same
 * status code a genuinely malformed request uses. Distinguishing the two
 * relies on the message text, the same best-effort approach the Anthropic
 * adapter already uses for its own ambiguous "context limit" case.
 */
export function mapGeminiError(error: unknown): LLMProviderError {
  if (error instanceof GeminiHttpError) {
    if (error.status === 401 || error.status === 403 || looksLikeInvalidApiKey(error.message)) {
      return new LLMAuthenticationError(PROVIDER_NAME, { cause: { status: error.status, message: error.message } });
    }
    if (error.status === 429) {
      return new LLMRateLimitError(PROVIDER_NAME, error.retryDelaySeconds, { cause: { status: error.status, message: error.message } });
    }
    if (error.status === 400) {
      if (looksLikeContextLimitMessage(error.message)) {
        return new LLMContextLimitExceededError(PROVIDER_NAME, { cause: { status: error.status, message: error.message } });
      }
      return new LLMInvalidRequestError(PROVIDER_NAME, error.message, { cause: { status: error.status } });
    }
    if (error.status >= 500) {
      return new LLMProviderUnavailableError(PROVIDER_NAME, { cause: { status: error.status, message: error.message } });
    }
    return new LLMInvalidRequestError(PROVIDER_NAME, error.message, { cause: { status: error.status } });
  }

  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new LLMTimeoutError(PROVIDER_NAME, { cause: { name: error.name } });
  }

  // fetch() throws a plain TypeError ("fetch failed") for DNS/network failures.
  if (error instanceof TypeError) {
    return new LLMProviderUnavailableError(PROVIDER_NAME, { cause: { name: error.name } });
  }

  return new LLMUnknownProviderError(PROVIDER_NAME, { cause: { name: error instanceof Error ? error.name : 'unknown' } });
}
