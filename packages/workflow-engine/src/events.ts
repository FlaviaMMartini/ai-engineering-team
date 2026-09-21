import { randomUUID } from 'node:crypto';
import type { TaskId, WorkflowEvent, WorkflowExecutionId } from '@aet/domain';
import type { WorkflowEventInput } from './types.js';

/**
 * No infrastructure decision baked in — Kafka/Redis/WebSockets/EventEmitter
 * are all explicitly out of scope for this phase. The real transport is a
 * later decision; this package only needs something to call.
 */
export interface WorkflowEventPublisher {
  publish(event: WorkflowEvent): Promise<void>;
}

/** Useful for composition/typecheck before a real transport exists — does nothing. */
export function createNoopWorkflowEventPublisher(): WorkflowEventPublisher {
  return {
    async publish(): Promise<void> {
      // intentionally empty
    }
  };
}

interface WorkflowEventEnvelope {
  taskId: TaskId;
  workflowExecutionId: WorkflowExecutionId;
  occurredAt: string;
}

/**
 * Fills in the envelope fields (id, taskId, workflowExecutionId,
 * occurredAt) around the caller-supplied semantic event input. `id`
 * generation is the one piece of internal state this package owns outright
 * (unlike domain's pure functions, this package is inherently a stateful
 * I/O coordinator, so generating an event id here — rather than requiring
 * the caller to invent one — is a reasonable, contained impurity).
 */
export function buildWorkflowEvent(envelope: WorkflowEventEnvelope, input: WorkflowEventInput): WorkflowEvent {
  return {
    id: randomUUID(),
    taskId: envelope.taskId,
    workflowExecutionId: envelope.workflowExecutionId,
    occurredAt: envelope.occurredAt,
    ...input
  } as WorkflowEvent;
}
