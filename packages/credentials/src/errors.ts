/**
 * One error class with a `kind` discriminant, matching the pattern already
 * used by @aet/orchestrator's `OrchestrationError` and @aet/git-integration/
 * @aet/persistence's typed errors. Messages here are already safe to show a
 * client as-is — never include the API key, a provider's raw response body,
 * or an Authorization header (see connect-provider.ts's use of
 * LLMProviderError, whose own `cause` is already sanitized).
 */
export type CredentialManagementErrorKind =
  | 'project_not_found'
  | 'provider_not_supported'
  | 'credential_not_configured'
  | 'credential_invalid'
  | 'credential_storage_error';

export class CredentialManagementError extends Error {
  readonly kind: CredentialManagementErrorKind;

  constructor(kind: CredentialManagementErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CredentialManagementError';
    this.kind = kind;
  }
}
