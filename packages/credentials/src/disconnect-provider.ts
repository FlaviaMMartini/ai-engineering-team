import { randomUUID } from 'node:crypto';
import type { ProjectProviderConfiguration } from '@aet/domain';
import { now, requireProject, requireSupportedProvider } from './support.js';
import type { CredentialManagementDependencies, ProjectProviderInput } from './types.js';

/**
 * CONNECTED -> DELETE -> NOT_CONFIGURED. Idempotent: disconnecting a
 * provider that was never connected (or already disconnected) succeeds and
 * reports `not_configured` rather than erroring — matching typical DELETE
 * semantics. The configuration row is updated (never deleted outright, so
 * `unique(project_id, provider)` keeps meaning "at most one row ever" and a
 * later reconnect is always an `update()`), then the now-unreferenced
 * credential is removed.
 */
export async function disconnectProviderCredential(
  deps: CredentialManagementDependencies,
  input: ProjectProviderInput
): Promise<ProjectProviderConfiguration> {
  requireProject(deps.persistence, input.projectId);
  const provider = requireSupportedProvider(input.provider);

  const existing = deps.persistence.projectProviderConfigurations.findByProjectAndProvider(input.projectId, provider);
  if (existing === null || existing.credentialReference === null) {
    return (
      existing ?? {
        id: randomUUID(),
        projectId: input.projectId,
        provider,
        status: 'not_configured',
        credentialReference: null,
        createdAt: now(),
        updatedAt: now()
      }
    );
  }

  const updated: ProjectProviderConfiguration = { ...existing, status: 'not_configured', credentialReference: null, updatedAt: now() };

  deps.persistence.transaction(() => {
    deps.persistence.projectProviderConfigurations.update(updated);
  });

  await deps.credentialStore.delete(existing.credentialReference);

  return updated;
}
