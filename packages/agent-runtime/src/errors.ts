import type { AgentExecutionError, LLMExecutorErrorKind } from './types.js';

export class AgentRuntimeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AgentRuntimeError';
  }
}

/**
 * @aet/providers' normalized errors (LLMAuthenticationError,
 * LLMRateLimitError, etc.) are Error subclasses with predictable `.name`
 * values — this maps those names to our own LLMExecutorErrorKind without
 * ever importing @aet/providers' classes, which would violate the
 * architectural boundary this phase must preserve.
 */
const ERROR_NAME_TO_KIND: Readonly<Record<string, LLMExecutorErrorKind>> = {
  LLMAuthenticationError: 'authentication',
  LLMInvalidRequestError: 'invalid_request',
  LLMRateLimitError: 'rate_limit',
  LLMContextLimitExceededError: 'context_limit',
  LLMProviderUnavailableError: 'provider_unavailable',
  LLMTimeoutError: 'timeout',
  LLMUnknownProviderError: 'unknown'
};

const RETRYABLE_KINDS: ReadonlySet<LLMExecutorErrorKind> = new Set(['rate_limit', 'provider_unavailable', 'timeout']);

function readRetryAfterSeconds(error: Error): number | null {
  const value = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' ? value : null;
}

/** Classifies anything an LLMExecutor.generate() call can throw. Never retries — only reports what kind of failure this was. */
export function classifyLLMError(error: unknown): AgentExecutionError {
  if (error instanceof Error) {
    const kind = ERROR_NAME_TO_KIND[error.name] ?? 'unknown';
    return {
      kind,
      message: error.message,
      retryable: RETRYABLE_KINDS.has(kind),
      retryAfterSeconds: readRetryAfterSeconds(error)
    };
  }
  return { kind: 'unknown', message: 'Unknown non-Error value thrown', retryable: false, retryAfterSeconds: null };
}

export function makeAgentExecutionError(
  kind: LLMExecutorErrorKind,
  message: string,
  retryable = false
): AgentExecutionError {
  return { kind, message, retryable, retryAfterSeconds: null };
}
