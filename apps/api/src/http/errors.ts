import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CredentialManagementError } from '@aet/credentials';
import { RepositoryManagementError } from '../composition/index.js';
import { OrchestrationError } from '@aet/orchestrator';
import { InvalidTransitionError, TaskNotFoundError as WorkflowTaskNotFoundError, WorkflowNotFoundError } from '@aet/workflow-engine';
import { DuplicateIdError, NotFoundError } from '@aet/persistence';

/**
 * Deliberate, narrow boundary exception (to be reported in the Phase 13
 * summary, not silently done): this module imports `WorkflowNotFoundError`
 * / `TaskNotFoundError` / `InvalidTransitionError` from `@aet/workflow-engine`
 * and `NotFoundError` / `DuplicateIdError` from `@aet/persistence`, neither
 * of which is in the "HTTP MAY depend on" list.
 *
 * Why it's necessary: `Orchestrator.getStatus()` calls
 * `workflowEngine.getExecution()` directly with no wrapping, and the retry
 * lookup inside `execute()`'s loop is likewise unwrapped — so these error
 * types can and do propagate past `OrchestrationError` to this layer.
 * Without recognizing them here, a 404-shaped condition (execution not
 * found, task not found) would fall through to the generic 500 branch below
 * and misreport a client error as a server error.
 *
 * The only use of these imports is `instanceof` narrowing to pick an HTTP
 * status/code — no business logic from either package is invoked here. Both
 * packages are already direct dependencies of `apps/api` (declared for
 * composition-root.ts since Phase 11), so this adds no new package
 * dependency, only a new *import* within `apps/api`.
 *
 * `RepositoryManagementError` (Phase 21) is not a package import at all —
 * it's `apps/api`'s own composition-layer error type (thrown by
 * composition-root.ts's repository registration/creation flow), imported
 * here for the same `instanceof` narrowing purpose. `server.ts` already
 * imports composition-root.ts directly to build the application, so this
 * introduces no new dependency direction, only this same narrow use one
 * file over.
 */

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function mapOrchestrationError(error: OrchestrationError): HttpError {
  switch (error.kind) {
    case 'task_not_found':
      return new HttpError(404, 'TASK_NOT_FOUND', error.message);
    case 'workflow_start_failed':
      return new HttpError(500, 'WORKFLOW_START_FAILED', error.message);
    case 'context_build_failed':
      return new HttpError(500, 'CONTEXT_BUILD_FAILED', error.message);
    case 'repository_unavailable':
      return new HttpError(409, 'REPOSITORY_UNAVAILABLE', error.message);
    case 'architect_failed':
      return new HttpError(500, 'ARCHITECT_FAILED', error.message);
    case 'worktree_creation_failed':
      return new HttpError(500, 'WORKTREE_CREATION_FAILED', error.message);
    case 'developer_failed':
      return new HttpError(500, 'DEVELOPER_FAILED', error.message);
    case 'qa_failed':
      return new HttpError(500, 'QA_FAILED', error.message);
    case 'workflow_transition_failed':
      return new HttpError(500, 'WORKFLOW_TRANSITION_FAILED', error.message);
    case 'cleanup_failed':
      return new HttpError(500, 'CLEANUP_FAILED', error.message);
    case 'execution_not_found':
      return new HttpError(404, 'EXECUTION_NOT_FOUND', error.message);
    case 'execution_task_mismatch':
      return new HttpError(409, 'EXECUTION_TASK_MISMATCH', error.message);
    case 'execution_not_reviewable':
      return new HttpError(409, 'EXECUTION_NOT_REVIEWABLE', error.message);
    case 'review_already_decided':
      return new HttpError(409, 'REVIEW_ALREADY_DECIDED', error.message);
    default:
      return new HttpError(500, 'INTERNAL_ERROR', 'An unexpected orchestration error occurred');
  }
}

function mapCredentialManagementError(error: CredentialManagementError): HttpError {
  switch (error.kind) {
    case 'project_not_found':
      return new HttpError(404, 'PROJECT_NOT_FOUND', error.message);
    case 'provider_not_supported':
      return new HttpError(400, 'PROVIDER_NOT_SUPPORTED', error.message);
    case 'credential_not_configured':
      return new HttpError(404, 'CREDENTIAL_NOT_CONFIGURED', error.message);
    case 'credential_invalid':
      return new HttpError(400, 'CREDENTIAL_INVALID', error.message);
    case 'credential_storage_error':
      return new HttpError(500, 'CREDENTIAL_STORAGE_ERROR', error.message);
    default:
      return new HttpError(500, 'INTERNAL_ERROR', 'An unexpected credential management error occurred');
  }
}

function mapRepositoryManagementError(error: RepositoryManagementError): HttpError {
  switch (error.kind) {
    case 'project_not_found':
      return new HttpError(404, 'PROJECT_NOT_FOUND', error.message);
    case 'repository_not_found':
      return new HttpError(404, 'REPOSITORY_NOT_FOUND', error.message);
    case 'invalid_repository_path':
      return new HttpError(400, 'INVALID_REPOSITORY_PATH', error.message);
    default:
      return new HttpError(500, 'INTERNAL_ERROR', 'An unexpected repository management error occurred');
  }
}

export function mapErrorToHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof OrchestrationError) {
    return mapOrchestrationError(error);
  }
  if (error instanceof CredentialManagementError) {
    return mapCredentialManagementError(error);
  }
  if (error instanceof RepositoryManagementError) {
    return mapRepositoryManagementError(error);
  }
  if (error instanceof WorkflowNotFoundError) {
    return new HttpError(404, 'WORKFLOW_NOT_FOUND', error.message);
  }
  if (error instanceof WorkflowTaskNotFoundError) {
    return new HttpError(404, 'TASK_NOT_FOUND', error.message);
  }
  if (error instanceof InvalidTransitionError) {
    return new HttpError(409, 'INVALID_TRANSITION', error.message);
  }
  if (error instanceof DuplicateIdError) {
    return new HttpError(409, 'DUPLICATE_RESOURCE', error.message);
  }
  if (error instanceof NotFoundError) {
    return new HttpError(404, 'NOT_FOUND', error.message);
  }
  return new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

function isFastifyValidationError(error: FastifyError): boolean {
  return Array.isArray(error.validation) && error.validation.length > 0;
}

/**
 * Fastify itself throws typed errors for malformed requests it rejects
 * before any route handler runs — e.g. `FST_ERR_CTP_INVALID_JSON_BODY` for
 * a body that isn't valid JSON despite a `application/json` content-type.
 * These already carry a correct 4xx `statusCode`; without this check they
 * fell through `mapErrorToHttpError`'s unrecognized-error branch and were
 * misreported as a 500 `INTERNAL_ERROR`, which is wrong (the client sent a
 * bad request, the server did nothing wrong) and hides a real client bug
 * behind a generic "server error" message.
 */
function isFastifyClientError(error: FastifyError): boolean {
  return typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500;
}

/**
 * Registers the global error and not-found handlers. Every error response
 * uses the `{"error":{"code":"...","message":"..."}}` shape — never a raw
 * stack trace, SQL fragment, or provider error body. 5xx errors are logged
 * server-side via the request's own logger before responding.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (isFastifyValidationError(error)) {
      reply.status(400).send({ error: { code: 'BAD_REQUEST', message: error.message } });
      return;
    }
    if (!(error instanceof HttpError) && isFastifyClientError(error)) {
      reply.status(error.statusCode as number).send({ error: { code: error.code ?? 'BAD_REQUEST', message: error.message } });
      return;
    }

    const httpError = mapErrorToHttpError(error);
    if (httpError.statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error while processing request');
    } else if (httpError.code === 'CREDENTIAL_INVALID') {
      // Diagnostic only, never the secret: `error.cause` here is an `LLMProviderError` (e.g.
      // LLMAuthenticationError vs LLMInvalidRequestError vs LLMRateLimitError) whose own message
      // and `.cause` are already sanitized (status/requestId/name only — see mapAnthropicError's
      // sanitizedCause) — this tells us WHY validation failed without ever touching the API key.
      const cause = error instanceof CredentialManagementError ? error.cause : undefined;
      request.log.warn(
        { causeName: cause instanceof Error ? cause.name : undefined, causeMessage: cause instanceof Error ? cause.message : undefined },
        'Credential validation rejected'
      );
    }
    reply.status(httpError.statusCode).send({ error: { code: httpError.code, message: httpError.message } });
  });

  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'No route matches this method and path' } });
  });
}
