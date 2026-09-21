import { randomUUID } from 'node:crypto';
import type { CredentialReference, ProjectProviderConfiguration } from '@aet/domain';
import { CredentialManagementError } from './errors.js';
import { describeValidationFailure, now, requireProject, requireSupportedProvider } from './support.js';
import type { CredentialManagementDependencies, ConnectProviderCredentialInput } from './types.js';

/**
 * CONNECT -> VALIDATE -> ENCRYPT -> STORE -> CONNECTED (Phase 19's
 * credential lifecycle). The API key exists in memory only for the
 * duration of this function — it is never logged, never attached to any
 * thrown error, and the plaintext is never returned to the caller.
 *
 * Replacement safety: if a provider is already connected, the NEW
 * credential is validated and encrypted before anything durable changes,
 * the configuration is updated to point at it inside one transaction, and
 * only after that commits is the OLD credential deleted — so a failure at
 * any point never leaves the project without its previously-working
 * credential (see the final `delete` call's placement).
 */
export async function connectProviderCredential(
  deps: CredentialManagementDependencies,
  input: ConnectProviderCredentialInput
): Promise<ProjectProviderConfiguration> {
  requireProject(deps.persistence, input.projectId);
  const provider = requireSupportedProvider(input.provider);

  const apiKey = input.apiKey.trim();
  if (apiKey.length === 0) {
    throw new CredentialManagementError('credential_invalid', 'API key must not be empty');
  }

  const validationProvider = deps.createProviderForValidation(provider, apiKey);
  try {
    await validationProvider.validateCredential?.();
  } catch (error) {
    throw new CredentialManagementError('credential_invalid', describeValidationFailure(error), { cause: error });
  }

  const existing = deps.persistence.projectProviderConfigurations.findByProjectAndProvider(input.projectId, provider);

  let newReference: CredentialReference;
  try {
    newReference = await deps.credentialStore.create(apiKey);
  } catch (error) {
    throw new CredentialManagementError('credential_storage_error', 'Failed to store the encrypted credential', { cause: error });
  }

  const timestamp = now();
  const updated: ProjectProviderConfiguration =
    existing === null
      ? {
          id: randomUUID(),
          projectId: input.projectId,
          provider,
          status: 'connected',
          credentialReference: newReference,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      : { ...existing, status: 'connected', credentialReference: newReference, updatedAt: timestamp };

  try {
    deps.persistence.transaction(() => {
      if (existing === null) {
        deps.persistence.projectProviderConfigurations.create(updated);
      } else {
        deps.persistence.projectProviderConfigurations.update(updated);
      }
    });
  } catch (error) {
    // The configuration never pointed at the new credential — remove the now-orphaned row
    // rather than leaking it. Best-effort: this failure must not mask the real error above.
    await deps.credentialStore.delete(newReference).catch(() => {});
    throw new CredentialManagementError('credential_storage_error', 'Failed to persist the provider configuration', { cause: error });
  }

  if (existing?.credentialReference != null) {
    await deps.credentialStore.delete(existing.credentialReference).catch(() => {});
  }

  return updated;
}
