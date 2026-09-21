import { apiRequest } from './client.js';
import type { CreateTaskResponseBody, ExecuteTaskResponseBody } from '../types/api.js';

export interface CreateTaskInput {
  projectId: string;
  /** Phase 21: omit to have the backend scaffold a brand-new repository for this task instead of targeting an existing one. */
  repositoryId?: string;
  /** Used only when `repositoryId` is omitted, to name the new repository. */
  newRepositoryName?: string;
  description: string;
}

export function createTask(input: CreateTaskInput): Promise<CreateTaskResponseBody> {
  return apiRequest<CreateTaskResponseBody>('/tasks', { method: 'POST', body: input });
}

export function executeTask(taskId: string): Promise<ExecuteTaskResponseBody> {
  // An explicit empty body, not an omitted one: the backend route reads
  // `request.body.maxContextTokens` unconditionally (its schema makes the
  // field optional, but not the body itself) — sending `{}` guarantees
  // Fastify parses a body object instead of leaving `request.body`
  // undefined. Solved here rather than in apps/api per this phase's rule
  // to fix frontend-integration issues in the frontend when possible.
  return apiRequest<ExecuteTaskResponseBody>(`/tasks/${encodeURIComponent(taskId)}/execute`, { method: 'POST', body: {} });
}
