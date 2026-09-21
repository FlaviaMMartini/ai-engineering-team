import type { TaskState } from '@aet/domain';

export class WorkflowEngineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkflowEngineError';
  }
}

export class WorkflowNotFoundError extends WorkflowEngineError {
  readonly executionId: string;

  constructor(executionId: string) {
    super(`WorkflowExecution not found: ${executionId}`);
    this.name = 'WorkflowNotFoundError';
    this.executionId = executionId;
  }
}

export class TaskNotFoundError extends WorkflowEngineError {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
    this.taskId = taskId;
  }
}

/**
 * Thrown after `domain.canTransition()` itself said no — this package
 * never decides that on its own, it only wraps domain's answer with the
 * task/execution identifiers domain has no reason to know about.
 */
export class InvalidTransitionError extends WorkflowEngineError {
  readonly taskId: string;
  readonly executionId: string;
  readonly from: TaskState;
  readonly to: TaskState;

  constructor(taskId: string, executionId: string, from: TaskState, to: TaskState) {
    super(`Invalid transition for task ${taskId} (execution ${executionId}): ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.taskId = taskId;
    this.executionId = executionId;
    this.from = from;
    this.to = to;
  }
}

/** Wraps any failure from the injected persistence repositories — never a raw SQLite/persistence error crosses this boundary. */
export class WorkflowPersistenceError extends WorkflowEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkflowPersistenceError';
  }
}

/** Thrown when the injected WorkflowEventPublisher rejects — always AFTER persistence already committed successfully; see engine.ts's atomicity note. */
export class EventPublishError extends WorkflowEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EventPublishError';
  }
}
