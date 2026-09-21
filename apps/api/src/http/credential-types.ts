import type { Project, ProjectProviderConfiguration, Repository } from '@aet/domain';
import type { TaskDto } from './types.js';

/**
 * BYOK transport DTOs (Phase 19). `ProviderConfigurationDto` is
 * deliberately minimal — `{provider, status}` only, never `id`,
 * `credentialReference`, or any timestamp — matching the exact response
 * shape this phase's endpoints are specified to return. No DTO in this
 * file, and no mapper below, ever reads or forwards a plaintext API key or
 * a credential's encrypted fields — `ProjectProviderConfiguration` itself
 * (the domain type these are built from) carries only an opaque
 * `credentialReference.id`, never a secret.
 */

// --- Projects ---

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface CreateProjectRequestBody {
  name: string;
  description?: string | null;
}

export interface CreateProjectResponseBody {
  project: ProjectDto;
}

export interface ListProjectsResponseBody {
  projects: readonly ProjectDto[];
}

export interface ProjectParams {
  projectId: string;
}

/** Phase 21 (Kanban board): a project's tasks, for grouping into state columns. Reuses `TaskDto` as-is — same shape `POST /tasks` already returns, no parallel type. */
export interface ListProjectTasksResponseBody {
  tasks: readonly TaskDto[];
}

export function toProjectDto(project: Project): ProjectDto {
  return { id: project.id, name: project.name, description: project.description, createdAt: project.createdAt };
}

// --- Provider configurations / credentials ---

export interface ProjectProviderParams {
  projectId: string;
  provider: string;
}

export interface ConnectProviderCredentialRequestBody {
  apiKey: string;
}

export interface ProviderConfigurationDto {
  provider: string;
  status: string;
}

export interface ProviderConfigurationResponseBody {
  provider: string;
  status: string;
}

export interface ListProviderConfigurationsResponseBody {
  providers: readonly ProviderConfigurationDto[];
}

export function toProviderConfigurationDto(config: ProjectProviderConfiguration): ProviderConfigurationDto {
  return { provider: config.provider, status: config.status };
}

// --- Repository selection (Phase 21) ---
// `localPath` is returned deliberately: the user themselves provided it (or named the new
// repository this scaffolded), so it is not secret information being newly exposed — the same
// reasoning `ProjectDto` already applies to a project's own name/description.

export interface RepositoryDto {
  id: string;
  projectId: string;
  name: string;
  localPath: string;
  defaultBranch: string;
  createdAt: string;
}

export interface RegisterRepositoryRequestBody {
  name: string;
  path: string;
}

export interface ListRepositoriesResponseBody {
  repositories: readonly RepositoryDto[];
}

export function toRepositoryDto(repository: Repository): RepositoryDto {
  return {
    id: repository.id,
    projectId: repository.projectId,
    name: repository.name,
    localPath: repository.localPath,
    defaultBranch: repository.defaultBranch,
    createdAt: repository.createdAt
  };
}
