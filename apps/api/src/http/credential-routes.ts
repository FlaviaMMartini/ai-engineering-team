import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Project } from '@aet/domain';
import type { ApplicationRuntime } from '../runtime/index.js';
import type {
  ConnectProviderCredentialRequestBody,
  CreateProjectRequestBody,
  CreateProjectResponseBody,
  ListProjectsResponseBody,
  ListProjectTasksResponseBody,
  ListProviderConfigurationsResponseBody,
  ListRepositoriesResponseBody,
  ProjectParams,
  ProjectProviderParams,
  ProviderConfigurationResponseBody,
  RegisterRepositoryRequestBody
} from './credential-types.js';
import { toProjectDto, toProviderConfigurationDto, toRepositoryDto } from './credential-types.js';
import { toTaskDto } from './types.js';
import {
  connectProviderCredentialBodySchema,
  createProjectBodySchema,
  projectParamsSchema,
  projectProviderParamsSchema,
  registerRepositoryBodySchema
} from './schemas.js';

/**
 * Phase 19 (BYOK): project identity + provider credential management.
 * Every handler here calls only `runtime.persistence.projects` (plain CRUD,
 * matching the existing `POST /tasks` precedent) or `runtime.credentials`
 * (see composition-root.ts's `CredentialManagementRuntime`) — never
 * `CredentialStore`, never `persistence.credentials`, never
 * `persistence.projectProviderConfigurations` directly, and never
 * `@aet/providers`/`@aet/credentials`' internals. No handler in this file
 * ever reads an API key back out of a response it sends — every response
 * body here is built exclusively from `toProjectDto`/`toProviderConfigurationDto`,
 * which only ever see the non-secret `Project`/`ProjectProviderConfiguration`
 * domain shapes.
 */
export function registerCredentialRoutes(app: FastifyInstance, runtime: ApplicationRuntime): void {
  app.post<{ Body: CreateProjectRequestBody }>('/projects', { schema: { body: createProjectBodySchema } }, async (request, reply) => {
    const { name, description } = request.body;
    const project: Project = {
      id: randomUUID(),
      name,
      description: description ?? null,
      createdAt: new Date().toISOString()
    };

    runtime.persistence.projects.create(project);

    const body: CreateProjectResponseBody = { project: toProjectDto(project) };
    reply.status(201).send(body);
  });

  app.get('/projects', async (_request, reply) => {
    const projects = runtime.persistence.projects.list();
    const body: ListProjectsResponseBody = { projects: projects.map(toProjectDto) };
    reply.status(200).send(body);
  });

  app.get<{ Params: ProjectParams }>('/projects/:projectId/providers', { schema: { params: projectParamsSchema } }, async (request, reply) => {
    const { projectId } = request.params;
    const configurations = runtime.credentials.listProviders(projectId);
    const body: ListProviderConfigurationsResponseBody = { providers: configurations.map(toProviderConfigurationDto) };
    reply.status(200).send(body);
  });

  // Phase 21 (Kanban board): matches /tasks' own precedent of calling
  // `runtime.persistence.tasks` directly for plain CRUD/list — no orchestrator
  // involvement, this never executes anything.
  app.get<{ Params: ProjectParams }>('/projects/:projectId/tasks', { schema: { params: projectParamsSchema } }, async (request, reply) => {
    const { projectId } = request.params;
    const tasks = runtime.persistence.tasks.listByProject(projectId);
    const body: ListProjectTasksResponseBody = { tasks: tasks.map(toTaskDto) };
    reply.status(200).send(body);
  });

  app.post<{ Params: ProjectProviderParams; Body: ConnectProviderCredentialRequestBody }>(
    '/projects/:projectId/providers/:provider/credentials',
    { schema: { params: projectProviderParamsSchema, body: connectProviderCredentialBodySchema } },
    async (request, reply) => {
      const { projectId, provider } = request.params;
      const { apiKey } = request.body;

      const configuration = await runtime.credentials.connectProvider({ projectId, provider, apiKey });

      const body: ProviderConfigurationResponseBody = toProviderConfigurationDto(configuration);
      reply.status(200).send(body);
    }
  );

  app.delete<{ Params: ProjectProviderParams }>(
    '/projects/:projectId/providers/:provider/credentials',
    { schema: { params: projectProviderParamsSchema } },
    async (request, reply) => {
      const { projectId, provider } = request.params;

      const configuration = await runtime.credentials.disconnectProvider({ projectId, provider });

      const body: ProviderConfigurationResponseBody = toProviderConfigurationDto(configuration);
      reply.status(200).send(body);
    }
  );

  app.post<{ Params: ProjectProviderParams }>(
    '/projects/:projectId/providers/:provider/validate',
    { schema: { params: projectProviderParamsSchema } },
    async (request, reply) => {
      const { projectId, provider } = request.params;

      const configuration = await runtime.credentials.validateProvider({ projectId, provider });

      const body: ProviderConfigurationResponseBody = toProviderConfigurationDto(configuration);
      reply.status(200).send(body);
    }
  );

  // --- Repository selection (Phase 21) ---
  // Both handlers call only `runtime.repositories` (composition-root.ts's
  // RepositoryManagementRuntime) — never `persistence.repositories` or
  // `@aet/git-integration` directly, mirroring the BYOK routes above.

  app.post<{ Params: ProjectParams; Body: RegisterRepositoryRequestBody }>(
    '/projects/:projectId/repositories',
    { schema: { params: projectParamsSchema, body: registerRepositoryBodySchema } },
    async (request, reply) => {
      const { projectId } = request.params;
      const { name, path } = request.body;
      const repository = await runtime.repositories.register({ projectId, name, path });
      reply.status(201).send(toRepositoryDto(repository));
    }
  );

  app.get<{ Params: ProjectParams }>('/projects/:projectId/repositories', { schema: { params: projectParamsSchema } }, async (request, reply) => {
    const { projectId } = request.params;
    const repositories = runtime.repositories.list(projectId);
    const body: ListRepositoriesResponseBody = { repositories: repositories.map(toRepositoryDto) };
    reply.status(200).send(body);
  });
}
