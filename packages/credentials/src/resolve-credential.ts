import type { ProjectId } from '@aet/domain';
import type { CredentialStore } from '@aet/persistence';
import type { CredentialProvider } from '@aet/providers';
import { CredentialManagementError } from './errors.js';
import { requireSupportedProvider } from './support.js';
import type { CredentialManagementPersistence } from './types.js';

export interface ProjectCredentialProviderDependencies {
  projectId: ProjectId;
  provider: string;
  persistence: Pick<CredentialManagementPersistence, 'projectProviderConfigurations'>;
  credentialStore: CredentialStore;
  /**
   * Dev/bootstrap-only fallback (Phase 19: this is where `ANTHROPIC_API_KEY`
   * ends up, if set — see apps/api's composition root). Never prioritized
   * over a real, connected project credential; used only when the project
   * has none.
   */
  fallbackApiKey?: string | null;
}

/**
 * The runtime counterpart to connect/disconnect/validate above: resolves
 * one project's credential for one provider at LLM-call time. This is the
 * `CredentialProvider` (@aet/providers) that a project-scoped
 * `AnthropicProvider` is constructed with — see the composition root's
 * per-execution wiring. Never caches the secret across calls; `getApiKey()`
 * re-resolves from persistence every time, so a credential rotated
 * mid-task takes effect on the very next call, and the secret exists in
 * memory only for the duration of that one call.
 */
export function createProjectCredentialProvider(deps: ProjectCredentialProviderDependencies): CredentialProvider {
  const provider = requireSupportedProvider(deps.provider);

  return {
    async getApiKey(): Promise<string> {
      const configuration = deps.persistence.projectProviderConfigurations.findByProjectAndProvider(deps.projectId, provider);

      if (configuration !== null && configuration.status === 'connected' && configuration.credentialReference !== null) {
        return deps.credentialStore.getSecret(configuration.credentialReference);
      }

      if (deps.fallbackApiKey !== undefined && deps.fallbackApiKey !== null && deps.fallbackApiKey.length > 0) {
        return deps.fallbackApiKey;
      }

      throw new CredentialManagementError(
        'credential_not_configured',
        `No credential is configured for provider "${provider}" on project ${deps.projectId}`
      );
    }
  };
}
