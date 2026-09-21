/**
 * Thrown when dependency composition fails. `cause` is always a sanitized
 * `{name, message}` pair (see composition-root.ts's `sanitizeStartupCause`)
 * — never the raw thrown value, which could in principle carry more than
 * intended. No composition step in this codebase currently constructs a
 * secret-bearing error (credential/provider construction is pure object
 * wiring; the actual network call is deferred until first use — see
 * providers' `createAnthropicClient`), but this sanitization boundary
 * exists regardless, as defense in depth, not because a concrete leak was found.
 */
export class StartupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StartupError';
  }
}

/** Phase 21 (repository selection): thrown by the repository registration/creation flow in composition-root.ts. */
export type RepositoryManagementErrorKind = 'project_not_found' | 'invalid_repository_path' | 'repository_not_found';

export class RepositoryManagementError extends Error {
  readonly kind: RepositoryManagementErrorKind;

  constructor(kind: RepositoryManagementErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RepositoryManagementError';
    this.kind = kind;
  }
}
