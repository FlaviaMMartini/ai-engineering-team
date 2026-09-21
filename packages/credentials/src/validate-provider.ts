import type { ProjectProviderConfiguration } from '@aet/domain';
import { CredentialManagementError } from './errors.js';
import { now, requireProject, requireSupportedProvider } from './support.js';
import type { CredentialManagementDependencies, ProjectProviderInput } from './types.js';

/**
 * Re-validates an already-connected credential against the live provider.
 * Never returns the secret — it only exists in memory for the duration of
 * `createProviderForValidation(...).validateCredential()`. On failure the
 * configuration is marked 'invalid' (not deleted — the encrypted credential
 * stays in place in case the failure was transient, e.g. the account was
 * temporarily rate-limited); connecting a new key is still the only way
 * back to 'connected'.
 */
export async function validateProviderCredential(
  deps: CredentialManagementDependencies,
  input: ProjectProviderInput
): Promise<ProjectProviderConfiguration> {
  requireProject(deps.persistence, input.projectId);
  const provider = requireSupportedProvider(input.provider);

  const existing = deps.persistence.projectProviderConfigurations.findByProjectAndProvider(input.projectId, provider);
  if (existing === null || existing.credentialReference === null) {
    throw new CredentialManagementError('credential_not_configured', `No credential is configured for provider "${provider}" on this project`);
  }

  const secret = await deps.credentialStore.getSecret(existing.credentialReference);
  const validationProvider = deps.createProviderForValidation(provider, secret);

  let status: ProjectProviderConfiguration['status'];
  try {
    await validationProvider.validateCredential?.();
    status = 'connected';
  } catch {
    status = 'invalid';
  }

  const updated: ProjectProviderConfiguration = { ...existing, status, updatedAt: now() };
  deps.persistence.transaction(() => {
    deps.persistence.projectProviderConfigurations.update(updated);
  });

  return updated;
}
