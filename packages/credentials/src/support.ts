import { isSupportedProviderName, type Project, type ProjectId, type ProviderName } from '@aet/domain';
import { LLMAuthenticationError, LLMProviderError, LLMRateLimitError } from '@aet/providers';
import { CredentialManagementError } from './errors.js';
import type { CredentialManagementPersistence } from './types.js';

export function requireProject(persistence: CredentialManagementPersistence, projectId: ProjectId): Project {
  const project = persistence.projects.findById(projectId);
  if (project === null) {
    throw new CredentialManagementError('project_not_found', `Project not found: ${projectId}`);
  }
  return project;
}

/** The one place a raw client-supplied `provider` string is checked against domain's supported list — never a scattered `if (provider === 'anthropic')`. */
export function requireSupportedProvider(provider: string): ProviderName {
  if (!isSupportedProviderName(provider)) {
    throw new CredentialManagementError('provider_not_supported', `Provider "${provider}" is not supported`);
  }
  return provider;
}

export function now(): string {
  return new Date().toISOString();
}

/**
 * Turns a `validateCredential()` failure into a safe, ACCURATE message —
 * never the raw provider response body (which can be verbose and isn't
 * meant for end users, even though it carries no secret), and critically,
 * never implying "the key itself is wrong" unless that's actually what
 * happened. A real key can fail validation for reasons that have nothing
 * to do with whether it's valid — no billing/credits on the account, a
 * rate limit, a transient provider outage. Only `LLMAuthenticationError`
 * means the credential itself was rejected.
 */
export function describeValidationFailure(error: unknown): string {
  if (error instanceof LLMAuthenticationError) {
    return 'The provided API key was rejected by the provider.';
  }
  if (error instanceof LLMRateLimitError) {
    return 'The provider is currently rate-limiting this credential. Please try again shortly.';
  }
  if (error instanceof LLMProviderError) {
    return 'The provider could not validate this credential right now. This is not necessarily a problem with the key itself — check your provider account status (e.g. billing/credits) or try again if the provider may be temporarily unavailable.';
  }
  return 'Unable to validate this credential right now.';
}
