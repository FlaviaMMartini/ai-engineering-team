import { canTransition, DEFAULT_MAX_RETRIES, retriesExhausted, transitionTask, type Task, type TaskId, type WorkflowExecution, type WorkflowExecutionId } from '@aet/domain';
import type { Persistence } from '@aet/persistence';
import { EventPublishError, InvalidTransitionError, TaskNotFoundError, WorkflowNotFoundError, WorkflowPersistenceError } from './errors.js';
import { buildWorkflowEvent, createNoopWorkflowEventPublisher, type WorkflowEventPublisher } from './events.js';
import type {
  RetryStatus,
  StartWorkflowInput,
  TransitionWorkflowInput,
  WorkflowEngine,
  WorkflowEngineResult
} from './types.js';

/**
 * Only the three operations this package actually uses — never the whole
 * `Persistence` surface (agentExecutions/llmRequests/contextMetrics belong
 * to the future Orchestrator and Agent Runtime, not to workflow state
 * lifecycle).
 */
export type WorkflowEnginePersistence = Pick<Persistence, 'tasks' | 'workflowExecutions' | 'transaction'>;

export interface WorkflowEngineDependencies {
  persistence: WorkflowEnginePersistence;
  /** Defaults to a no-op publisher — the real transport is a later decision (see events.ts). */
  eventPublisher?: WorkflowEventPublisher;
}

const TERMINAL_TASK_STATES = new Set(['DONE', 'FAILED']);

function loadTask(persistence: WorkflowEnginePersistence, taskId: TaskId): Task {
  let task: Task | null;
  try {
    task = persistence.tasks.findById(taskId);
  } catch (error) {
    throw new WorkflowPersistenceError(`Failed to load task ${taskId}`, { cause: error });
  }
  if (task === null) {
    throw new TaskNotFoundError(taskId);
  }
  return task;
}

function loadExecution(persistence: WorkflowEnginePersistence, executionId: WorkflowExecutionId): WorkflowExecution {
  let execution: WorkflowExecution | null;
  try {
    execution = persistence.workflowExecutions.findById(executionId);
  } catch (error) {
    throw new WorkflowPersistenceError(`Failed to load WorkflowExecution ${executionId}`, { cause: error });
  }
  if (execution === null) {
    throw new WorkflowNotFoundError(executionId);
  }
  return execution;
}

/**
 * Creates the Workflow Engine. This is a coordinator, not the Orchestrator:
 * it never decides which agent runs next, never inspects LLM/provider
 * errors, and never contains `if (state === X) run...()` logic — that is
 * explicitly Phase 10's job. Every legality decision about task state
 * comes from `@aet/domain`'s `canTransition`/`transitionTask`, called
 * here, never re-derived.
 */
export function createWorkflowEngine(deps: WorkflowEngineDependencies): WorkflowEngine {
  const { persistence } = deps;
  const publisher = deps.eventPublisher ?? createNoopWorkflowEventPublisher();

  async function publish(taskId: TaskId, workflowExecutionId: WorkflowExecutionId, occurredAt: string, input: TransitionWorkflowInput['event']): Promise<void> {
    const event = buildWorkflowEvent({ taskId, workflowExecutionId, occurredAt }, input);
    try {
      await publisher.publish(event);
    } catch (error) {
      // By this point persistence has already committed successfully (see
      // transition()/start() below) — this error means the event stream and
      // the persisted state have diverged, a real, documented limitation
      // (see the Phase 9 report's "Atomicity limitations"), not something
      // this phase builds outbox/retry infrastructure to fix.
      throw new EventPublishError(`Failed to publish ${event.type} for workflow ${workflowExecutionId}`, { cause: error });
    }
  }

  return {
    /**
     * Creates and persists a WorkflowExecution row only — it does NOT
     * transition the Task's own state (the Task may already be BACKLOG
     * from its own creation). Moving the Task out of BACKLOG is done via a
     * separate `transition()` call, keeping "an execution attempt began"
     * and "the task's state changed" as the two distinct concerns the
     * given interface shape implies.
     *
     * Default event `TASK_CREATED` is the closest existing domain event —
     * domain has no dedicated "WORKFLOW_EXECUTION_STARTED" type. This is
     * an honest approximation for the first execution of a task; for a
     * hypothetical retried-from-scratch second execution of the same task,
     * this event name is a semantic stretch, which is why callers may pass
     * their own `event` instead.
     */
    async start(input: StartWorkflowInput): Promise<WorkflowEngineResult> {
      const task = loadTask(persistence, input.taskId);

      const execution: WorkflowExecution = {
        id: input.executionId,
        taskId: input.taskId,
        status: 'RUNNING',
        startedAt: input.startedAt,
        completedAt: null
      };

      try {
        persistence.workflowExecutions.create(execution);
      } catch (error) {
        throw new WorkflowPersistenceError(`Failed to create WorkflowExecution ${input.executionId}`, { cause: error });
      }

      await publish(input.taskId, input.executionId, input.startedAt, input.event ?? { type: 'TASK_CREATED' });

      return { task, workflowExecution: execution };
    },

    /**
     * The only place `domain.transitionTask` is called during automated
     * pipeline execution (`Orchestrator.execute()`). Task and
     * WorkflowExecution updates are persisted together inside one
     * `persistence.transaction()` call (both are synchronous repository
     * writes, fitting its synchronous callback contract) — event
     * publication happens AFTER that transaction commits and is NOT part
     * of the same atomicity guarantee (see this module's `publish` helper
     * and the Phase 9 report).
     *
     * Phase 16 adds one other, narrow caller:
     * `Orchestrator.reviewExecution()` (packages/orchestrator/src/review.ts)
     * also calls `domain.transitionTask` directly, because it must persist
     * a new `HumanReviewDecision` row atomically together with the
     * Task/WorkflowExecution update — a guarantee this method's own
     * self-contained transaction cannot extend to. Domain remains the only
     * source of transition legality either way; only the transaction
     * boundary differs.
     */
    async transition(input: TransitionWorkflowInput): Promise<WorkflowEngineResult> {
      const task = loadTask(persistence, input.taskId);
      const execution = loadExecution(persistence, input.executionId);

      if (!canTransition(task.state, input.to)) {
        throw new InvalidTransitionError(input.taskId, input.executionId, task.state, input.to);
      }

      const updatedTask = transitionTask(task, input.to, input.timestamp);

      const isTerminal = TERMINAL_TASK_STATES.has(input.to);
      const updatedExecution: WorkflowExecution = {
        ...execution,
        status: isTerminal ? (input.to === 'DONE' ? 'COMPLETED' : 'FAILED') : execution.status,
        completedAt: isTerminal ? input.timestamp : execution.completedAt
      };

      try {
        persistence.transaction(() => {
          persistence.tasks.update(updatedTask);
          persistence.workflowExecutions.update(updatedExecution);
        });
      } catch (error) {
        throw new WorkflowPersistenceError(
          `Failed to persist transition ${task.state} -> ${input.to} for task ${input.taskId}`,
          { cause: error }
        );
      }

      await publish(input.taskId, input.executionId, input.timestamp, input.event);

      return { task: updatedTask, workflowExecution: updatedExecution };
    },

    async getExecution(executionId: WorkflowExecutionId): Promise<WorkflowExecution | null> {
      try {
        return persistence.workflowExecutions.findById(executionId);
      } catch (error) {
        throw new WorkflowPersistenceError(`Failed to load WorkflowExecution ${executionId}`, { cause: error });
      }
    },

    async getRetryStatus(taskId: TaskId): Promise<RetryStatus> {
      const task = loadTask(persistence, taskId);
      return {
        retryCount: task.retryCount,
        maxRetries: DEFAULT_MAX_RETRIES,
        retriesExhausted: retriesExhausted(task)
      };
    }
  };
}
