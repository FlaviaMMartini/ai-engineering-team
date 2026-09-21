import type { Task, TaskId, TaskState, WorkflowEvent, WorkflowExecution, WorkflowExecutionId } from '@aet/domain';

/** `Omit` alone does not distribute over a union — this does, so each WorkflowEvent variant keeps its own extra fields after removing the envelope ones. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What a caller (the future Orchestrator) supplies when asking for an
 * event to be published: the semantic part only (`type` and that variant's
 * own fields, e.g. `{ type: 'QA_FAILED', reason: '...' }`). Workflow
 * Engine fills in the envelope (`id`, `taskId`, `workflowExecutionId`,
 * `occurredAt`) itself, since those are mechanical bookkeeping concerns it
 * legitimately owns — not because it knows *why* a transition happened.
 */
export type WorkflowEventInput = DistributiveOmit<WorkflowEvent, 'id' | 'taskId' | 'workflowExecutionId' | 'occurredAt'>;

export interface StartWorkflowInput {
  executionId: WorkflowExecutionId;
  taskId: TaskId;
  startedAt: string;
  /** Defaults to `{ type: 'TASK_CREATED' }` — see engine.ts's doc comment on `start()` for why that's an approximation, not a perfect semantic match. */
  event?: WorkflowEventInput;
}

export interface TransitionWorkflowInput {
  executionId: WorkflowExecutionId;
  taskId: TaskId;
  to: TaskState;
  timestamp: string;
  /** Required (no default): only the caller knows *why* this transition is happening, and domain has no single generic "state changed" event to fall back on. */
  event: WorkflowEventInput;
}

export interface WorkflowEngineResult {
  task: Task;
  workflowExecution: WorkflowExecution;
}

export interface RetryStatus {
  retryCount: number;
  maxRetries: number;
  retriesExhausted: boolean;
}

/**
 * Provider-agnostic, HTTP-agnostic, agent-agnostic. Every method here is
 * about workflow *state* lifecycle — never about running an agent, calling
 * a model, or touching Git/the filesystem.
 */
export interface WorkflowEngine {
  start(input: StartWorkflowInput): Promise<WorkflowEngineResult>;
  transition(input: TransitionWorkflowInput): Promise<WorkflowEngineResult>;
  getExecution(executionId: WorkflowExecutionId): Promise<WorkflowExecution | null>;
  /** Pure pass-through to @aet/domain's `retriesExhausted` — never a second retry policy. */
  getRetryStatus(taskId: TaskId): Promise<RetryStatus>;
}
