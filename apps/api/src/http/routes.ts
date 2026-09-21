import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ZERO_TOKEN_USAGE, type Task, type TokenBudget } from '@aet/domain';
import type { ApplicationRuntime } from '../runtime/index.js';
import { HttpError } from './errors.js';
import {
  createTaskBodySchema,
  executeTaskBodySchema,
  executionParamsSchema,
  reviewExecutionBodySchema,
  taskParamsSchema
} from './schemas.js';
import type {
  CreateTaskRequestBody,
  CreateTaskResponseBody,
  ExecuteTaskRequestBody,
  ExecuteTaskResponseBody,
  ExecutionDetailsResponseBody,
  ExecutionDiffResponseBody,
  ExecutionParams,
  ReviewExecutionRequestBody,
  ReviewExecutionResponseBody,
  TaskParams
} from './types.js';
import { toExecutionDetailsDto, toExecutionDiffDto, toReviewExecutionResponseDto, toTaskDto, toWorkflowExecutionDto } from './types.js';

/**
 * Chosen once, here, since neither the domain nor the orchestrator defines a
 * default: a route-level policy for "how much context to allocate if the
 * caller doesn't say," not a business rule that belongs in `orchestrator`.
 */
const DEFAULT_MAX_CONTEXT_TOKENS = 50_000;

export function registerRoutes(app: FastifyInstance, runtime: ApplicationRuntime): void {
  app.get('/health', async () => ({ status: 'ok' }));

  app.post<{ Body: CreateTaskRequestBody }>(
    '/tasks',
    { schema: { body: createTaskBodySchema } },
    async (request, reply) => {
      const { projectId, repositoryId, newRepositoryName, description, maxTokens, maxCost } = request.body;
      const now = new Date().toISOString();

      // Phase 21 (repository selection): no repositoryId means "start a new project" — this
      // scaffolds a fresh repository (git init + one initial commit, see git-integration's
      // initializeNewRepository) rather than defaulting to some pre-existing one. A name is
      // required either way; when the caller didn't supply one, this derives a short, honest
      // default from the task description rather than a generic placeholder.
      const resolvedRepositoryId =
        repositoryId ??
        (await runtime.repositories.createNew({
          projectId,
          name: newRepositoryName ?? `New project: ${description.slice(0, 40)}`
        })).id;

      const task: Task = {
        id: randomUUID(),
        projectId,
        repositoryId: resolvedRepositoryId,
        description,
        state: 'BACKLOG',
        branchName: null,
        retryCount: 0,
        createdAt: now,
        updatedAt: now
      };

      const budget: TokenBudget = {
        taskId: task.id,
        maxTokens: maxTokens ?? null,
        maxCost: maxCost ?? null,
        currency: 'USD',
        estimatedUsage: ZERO_TOKEN_USAGE,
        actualUsage: ZERO_TOKEN_USAGE,
        estimatedCost: null,
        calculatedCost: null
      };

      runtime.persistence.tasks.create(task, budget);

      const body: CreateTaskResponseBody = { task: toTaskDto(task) };
      reply.status(201).send(body);
    }
  );

  app.post<{ Params: TaskParams; Body: ExecuteTaskRequestBody }>(
    '/tasks/:taskId/execute',
    { schema: { params: taskParamsSchema, body: executeTaskBodySchema } },
    async (request, reply) => {
      const { taskId } = request.params;
      const maxContextTokens = request.body.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;

      const result = await runtime.orchestrator.execute({
        taskId,
        executionId: randomUUID(),
        maxContextTokens
      });

      const body: ExecuteTaskResponseBody = {
        outcome: result.outcome,
        task: toTaskDto(result.task),
        workflowExecution: toWorkflowExecutionDto(result.workflowExecution),
        architectPlan: result.architectPlan,
        developerOutput: result.developerOutput,
        qaResult: result.qaResult,
        worktreePath: result.worktree?.path ?? null,
        taskTokenMetrics: result.taskTokenMetrics,
        errorMessage: result.errorMessage
      };
      reply.status(200).send(body);
    }
  );

  app.get<{ Params: ExecutionParams }>(
    '/executions/:executionId',
    { schema: { params: executionParamsSchema } },
    async (request, reply) => {
      const { executionId } = request.params;
      const execution = await runtime.orchestrator.getStatus(executionId);
      if (execution === null) {
        throw new HttpError(404, 'WORKFLOW_NOT_FOUND', `No execution found with id "${executionId}"`);
      }
      reply.status(200).send(toWorkflowExecutionDto(execution));
    }
  );

  // --- Human review (Phase 16) ---
  // A command endpoint, like /tasks/:taskId/execute — it calls the
  // Orchestrator's `reviewExecution()` operation and nothing else. It does
  // NOT call transitionTask()/canTransition() itself, write persistence
  // directly, or touch Git — domain owns transition validity, the
  // Orchestrator owns the atomic decision+transition transaction, and Git
  // integration is never involved (see review.ts: no merge/push/PR).

  app.post<{ Params: ExecutionParams; Body: ReviewExecutionRequestBody }>(
    '/executions/:executionId/review',
    { schema: { params: executionParamsSchema, body: reviewExecutionBodySchema } },
    async (request, reply) => {
      const { executionId } = request.params;
      const { taskId, decision, comment } = request.body;

      const result = await runtime.orchestrator.reviewExecution({
        executionId,
        taskId,
        decision,
        comment: comment ?? null
      });

      const body: ReviewExecutionResponseBody = toReviewExecutionResponseDto(result);
      reply.status(200).send(body);
    }
  );

  // --- Execution diff (Phase 17) ---
  // A pure query, like the observability endpoints below — but it goes
  // through `runtime.orchestrator.getExecutionDiff()` rather than the
  // execution read model, since it needs Git integration (which the read
  // model deliberately never depends on). This route never imports
  // @aet/git-integration itself, never receives a worktree/repository path
  // from the client, and never returns one — `executionId` is the only
  // identifier the client supplies.

  app.get<{ Params: ExecutionParams }>(
    '/executions/:executionId/diff',
    { schema: { params: executionParamsSchema } },
    async (request, reply) => {
      const { executionId } = request.params;
      const diff = await runtime.orchestrator.getExecutionDiff(executionId);
      if (diff === null) {
        throw new HttpError(404, 'DIFF_NOT_AVAILABLE', `No diff is available for execution "${executionId}"`);
      }
      const body: ExecutionDiffResponseBody = toExecutionDiffDto(diff);
      reply.status(200).send(body);
    }
  );

  // --- Read-only observability endpoints (Phase 14) ---
  // Both routes go straight to `runtime.executionReadModel`, never
  // `runtime.orchestrator` — they must not execute anything, only query
  // already-persisted execution data.

  app.get<{ Params: ExecutionParams }>(
    '/executions/:executionId/details',
    { schema: { params: executionParamsSchema } },
    async (request, reply) => {
      const { executionId } = request.params;
      const details = await runtime.executionReadModel.getExecution(executionId);
      if (details === null) {
        throw new HttpError(404, 'WORKFLOW_NOT_FOUND', `No execution found with id "${executionId}"`);
      }
      const body: ExecutionDetailsResponseBody = toExecutionDetailsDto(details);
      reply.status(200).send(body);
    }
  );

  app.get<{ Params: TaskParams }>(
    '/tasks/:taskId/execution',
    { schema: { params: taskParamsSchema } },
    async (request, reply) => {
      const { taskId } = request.params;
      const details = await runtime.executionReadModel.getTaskExecution(taskId);
      if (details === null) {
        throw new HttpError(404, 'WORKFLOW_NOT_FOUND', `No execution found for task "${taskId}"`);
      }
      const body: ExecutionDetailsResponseBody = toExecutionDetailsDto(details);
      reply.status(200).send(body);
    }
  );
}
