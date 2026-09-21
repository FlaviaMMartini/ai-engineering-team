import { apiRequest } from './client.js';
import type {
  ExecutionDetailsResponseBody,
  ExecutionDiffResponseBody,
  ReviewDecisionType,
  ReviewExecutionResponseBody,
  WorkflowExecutionDto
} from '../types/api.js';

export function getExecution(executionId: string): Promise<WorkflowExecutionDto> {
  return apiRequest<WorkflowExecutionDto>(`/executions/${encodeURIComponent(executionId)}`);
}

export function getExecutionDetails(executionId: string): Promise<ExecutionDetailsResponseBody> {
  return apiRequest<ExecutionDetailsResponseBody>(`/executions/${encodeURIComponent(executionId)}/details`);
}

export function getTaskExecution(taskId: string): Promise<ExecutionDetailsResponseBody> {
  return apiRequest<ExecutionDetailsResponseBody>(`/tasks/${encodeURIComponent(taskId)}/execution`);
}

export interface ReviewExecutionInput {
  taskId: string;
  decision: ReviewDecisionType;
  comment: string | null;
}

export function reviewExecution(executionId: string, input: ReviewExecutionInput): Promise<ReviewExecutionResponseBody> {
  return apiRequest<ReviewExecutionResponseBody>(`/executions/${encodeURIComponent(executionId)}/review`, {
    method: 'POST',
    body: input
  });
}

/** Fetched only on explicit user interaction (the "View Diff" button) — never automatically. */
export function getExecutionDiff(executionId: string): Promise<ExecutionDiffResponseBody> {
  return apiRequest<ExecutionDiffResponseBody>(`/executions/${encodeURIComponent(executionId)}/diff`);
}
