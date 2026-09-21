/**
 * Renders whatever detail an adapter's error mapper attached as `cause` into
 * a short human-readable suffix. Every generic-template error below
 * (provider unavailable, timeout, rate limit, auth, ...) used to construct
 * its `.message` from the template alone and stuff the real diagnostic
 * detail — an HTTP status/vendor message, or a network error's name — into
 * `cause`, where nothing downstream ever read it. `AgentExecutionError`
 * (agent-runtime's `classifyLLMError`) only ever copies `error.message`, so
 * a genuinely useful cause (e.g. Gemini's actual 503 body, or "fetch failed"
 * for a DNS failure) was silently discarded before it ever reached a human —
 * the UI could only ever show "gemini: provider unavailable" with no way to
 * tell a real outage from a local network problem. This is read back out at
 * construction time so every subclass's message carries it without each one
 * repeating the same shape-sniffing.
 */
function describeCause(cause: unknown): string | null {
  if (cause === null || typeof cause !== 'object') return null;
  const record = cause as Record<string, unknown>;
  if (typeof record.status === 'number' && typeof record.message === 'string') {
    return `HTTP ${record.status}: ${record.message}`;
  }
  if (typeof record.message === 'string') return record.message;
  if (typeof record.name === 'string') return record.name;
  return null;
}

function withCauseDetail(message: string, cause: unknown): string {
  const detail = describeCause(cause);
  return detail === null ? message : `${message} (${detail})`;
}

/**
 * One class per normalized failure mode, matching the pattern already used
 * by git-integration/persistence/context-engine/model-router in this
 * codebase. Every constructor takes `provider` and an optional `cause` —
 * never the raw API key or authorization header (see each adapter's error
 * mapper for the redaction rule).
 */
export class LLMProviderError extends Error {
  readonly provider: string;

  constructor(provider: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LLMProviderError';
    this.provider = provider;
  }
}

export class LLMAuthenticationError extends LLMProviderError {
  constructor(provider: string, options?: { cause?: unknown }) {
    super(provider, withCauseDetail(`${provider}: authentication failed`, options?.cause), options);
    this.name = 'LLMAuthenticationError';
  }
}

export class LLMInvalidRequestError extends LLMProviderError {
  constructor(provider: string, message: string, options?: { cause?: unknown }) {
    super(provider, `${provider}: invalid request — ${message}`, options);
    this.name = 'LLMInvalidRequestError';
  }
}

export class LLMRateLimitError extends LLMProviderError {
  readonly retryAfterSeconds: number | null;

  constructor(provider: string, retryAfterSeconds: number | null = null, options?: { cause?: unknown }) {
    super(provider, withCauseDetail(`${provider}: rate limited`, options?.cause), options);
    this.name = 'LLMRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class LLMContextLimitExceededError extends LLMProviderError {
  constructor(provider: string, options?: { cause?: unknown }) {
    super(provider, withCauseDetail(`${provider}: context limit exceeded`, options?.cause), options);
    this.name = 'LLMContextLimitExceededError';
  }
}

export class LLMProviderUnavailableError extends LLMProviderError {
  constructor(provider: string, options?: { cause?: unknown }) {
    super(provider, withCauseDetail(`${provider}: provider unavailable`, options?.cause), options);
    this.name = 'LLMProviderUnavailableError';
  }
}

export class LLMTimeoutError extends LLMProviderError {
  constructor(provider: string, options?: { cause?: unknown }) {
    super(provider, withCauseDetail(`${provider}: request timed out`, options?.cause), options);
    this.name = 'LLMTimeoutError';
  }
}

export class LLMUnknownProviderError extends LLMProviderError {
  constructor(provider: string, options?: { cause?: unknown }) {
    super(provider, withCauseDetail(`${provider}: unknown provider error`, options?.cause), options);
    this.name = 'LLMUnknownProviderError';
  }
}
