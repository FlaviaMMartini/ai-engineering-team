import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError
} from '@anthropic-ai/sdk';
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

const PROVIDER_NAME = 'anthropic';

/**
 * Never attaches the raw SDK error as `cause` — `APIError` carries
 * `.headers` (including the Authorization header the request was sent
 * with) and the raw request/response `.error` body. This extracts only
 * status/request-id/name, which is enough for diagnosis without ever being
 * able to leak the API key through a logged error's cause chain.
 */
function sanitizedCause(error: APIError): { status: number | undefined; requestId: string | null | undefined; name: string } {
  return { status: error.status, requestId: error.request_id, name: error.name };
}

function looksLikeContextLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('too long') || lower.includes('maximum context') || lower.includes('context length') || lower.includes('too many tokens');
}

function extractRetryAfterSeconds(headers: APIError['headers']): number | null {
  const raw = headers?.['retry-after'];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Translates any error `AnthropicProvider.generate()` can throw into one of
 * this package's normalized error types. Anthropic has no dedicated
 * "context limit exceeded" status code — that case is inferred from a
 * BadRequestError's message text, on a best-effort basis.
 */
export function mapAnthropicError(error: unknown): LLMProviderError {
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new LLMAuthenticationError(PROVIDER_NAME, { cause: sanitizedCause(error) });
  }

  if (error instanceof RateLimitError) {
    return new LLMRateLimitError(PROVIDER_NAME, extractRetryAfterSeconds(error.headers), { cause: sanitizedCause(error) });
  }

  if (error instanceof BadRequestError) {
    if (looksLikeContextLimitMessage(error.message)) {
      return new LLMContextLimitExceededError(PROVIDER_NAME, { cause: sanitizedCause(error) });
    }
    return new LLMInvalidRequestError(PROVIDER_NAME, error.message, { cause: sanitizedCause(error) });
  }

  if (error instanceof NotFoundError || error instanceof UnprocessableEntityError || error instanceof ConflictError) {
    return new LLMInvalidRequestError(PROVIDER_NAME, error.message, { cause: sanitizedCause(error) });
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new LLMTimeoutError(PROVIDER_NAME, { cause: { name: error.name } });
  }

  if (error instanceof APIConnectionError || error instanceof InternalServerError) {
    return new LLMProviderUnavailableError(PROVIDER_NAME, { cause: sanitizedCause(error) });
  }

  if (error instanceof APIError) {
    return new LLMUnknownProviderError(PROVIDER_NAME, { cause: sanitizedCause(error) });
  }

  return new LLMUnknownProviderError(PROVIDER_NAME, { cause: { name: error instanceof Error ? error.name : 'unknown' } });
}
