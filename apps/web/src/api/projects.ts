import { apiRequest } from './client.js';
import type {
  ConnectProviderCredentialRequestBody,
  CreateProjectRequestBody,
  CreateProjectResponseBody,
  ListProjectsResponseBody,
  ListProjectTasksResponseBody,
  ListProviderConfigurationsResponseBody,
  ListRepositoriesResponseBody,
  ProviderConfigurationDto,
  RegisterRepositoryRequestBody,
  RepositoryDto
} from '../types/api.js';

export function createProject(input: CreateProjectRequestBody): Promise<CreateProjectResponseBody> {
  return apiRequest<CreateProjectResponseBody>('/projects', { method: 'POST', body: input });
}

export function listProjects(): Promise<ListProjectsResponseBody> {
  return apiRequest<ListProjectsResponseBody>('/projects');
}

export function listProviders(projectId: string): Promise<ListProviderConfigurationsResponseBody> {
  return apiRequest<ListProviderConfigurationsResponseBody>(`/projects/${encodeURIComponent(projectId)}/providers`);
}

/** The API key exists in this request body only for the duration of the call — never stored, never returned. */
export function connectProvider(projectId: string, provider: string, apiKey: string): Promise<ProviderConfigurationDto> {
  const body: ConnectProviderCredentialRequestBody = { apiKey };
  return apiRequest<ProviderConfigurationDto>(
    `/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(provider)}/credentials`,
    { method: 'POST', body }
  );
}

export function disconnectProvider(projectId: string, provider: string): Promise<ProviderConfigurationDto> {
  return apiRequest<ProviderConfigurationDto>(
    `/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(provider)}/credentials`,
    { method: 'DELETE' }
  );
}

export function validateProvider(projectId: string, provider: string): Promise<ProviderConfigurationDto> {
  return apiRequest<ProviderConfigurationDto>(
    `/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(provider)}/validate`,
    { method: 'POST' }
  );
}

export function listProjectTasks(projectId: string): Promise<ListProjectTasksResponseBody> {
  return apiRequest<ListProjectTasksResponseBody>(`/projects/${encodeURIComponent(projectId)}/tasks`);
}

export function listRepositories(projectId: string): Promise<ListRepositoriesResponseBody> {
  return apiRequest<ListRepositoriesResponseBody>(`/projects/${encodeURIComponent(projectId)}/repositories`);
}

export function registerRepository(projectId: string, input: RegisterRepositoryRequestBody): Promise<RepositoryDto> {
  return apiRequest<RepositoryDto>(`/projects/${encodeURIComponent(projectId)}/repositories`, { method: 'POST', body: input });
}
