import type { ProjectId, ProjectProviderConfiguration } from '@aet/domain';
import { requireProject } from './support.js';
import type { CredentialManagementPersistence } from './types.js';

/** Read-only — never touches CredentialStore, so a secret can never even theoretically reach this path. */
export function listProviderConfigurations(
  persistence: CredentialManagementPersistence,
  projectId: ProjectId
): readonly ProjectProviderConfiguration[] {
  requireProject(persistence, projectId);
  return persistence.projectProviderConfigurations.findByProjectId(projectId);
}
