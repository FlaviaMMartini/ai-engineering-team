import { randomUUID } from 'node:crypto';
import { canTransition, transitionTask, type HumanReviewDecision, type Task, type WorkflowExecution } from '@aet/domain';
import { createNoopWorkflowEventPublisher, type WorkflowEventPublisher } from '@aet/workflow-engine';
import { OrchestrationError } from './errors.js';
import type { OrchestratorPersistence } from './recording.js';
import type { HumanReviewResult, ReviewExecutionInput } from './types.js';

function now(): string {
  return new Date().toISOString();
}

/**
 * The Orchestrator's one human-decision use case: "the human reviewed the
 * AI execution result and approved/rejected it." This is explicitly NOT
 * Git merge/push/PR creation — this function never imports
 * @aet/git-integration and never touches a worktree; the approved
 * worktree/branch remains exactly as the pipeline left it (see
 * ARCHITECTURE.md's Phase 16 section).
 *
 * Atomicity: unlike `execute()`'s own transitions (which always go through
 * `WorkflowEngine.transition()`, the sole caller of
 * `domain.transitionTask()` during automated pipeline execution), this
 * function calls `canTransition`/`transitionTask` directly so the new
 * `HumanReviewDecision` row and the Task/WorkflowExecution update can be
 * written inside ONE `persistence.transaction()` — Phase 16 requires that
 * a decision can never exist without its corresponding transition, which
 * `WorkflowEngine.transition()`'s own (separate, encapsulated) transaction
 * cannot give us without either duplicating its internals or accepting a
 * two-transaction gap. `canTransition`/`transitionTask` remain the *only*
 * source of transition legality — nothing here re-implements the FSM.
 * Event publication happens only after that transaction commits, exactly
 * like WorkflowEngine's own `transition()` — no outbox, matching the rest
 * of this codebase's accepted, documented atomicity limitation for events.
 */
export async function reviewExecution(
  persistence: OrchestratorPersistence,
  eventPublisher: WorkflowEventPublisher | undefined,
  input: ReviewExecutionInput
): Promise<HumanReviewResult> {
  const publisher = eventPublisher ?? createNoopWorkflowEventPublisher();

  const task = persistence.tasks.findById(input.taskId);
  if (task === null) {
    throw new OrchestrationError('task_not_found', `Task not found: ${input.taskId}`);
  }

  const execution = persistence.workflowExecutions.findById(input.executionId);
  if (execution === null) {
    throw new OrchestrationError('execution_not_found', `WorkflowExecution not found: ${input.executionId}`);
  }

  if (execution.taskId !== task.id) {
    throw new OrchestrationError(
      'execution_task_mismatch',
      `Execution ${input.executionId} does not belong to task ${input.taskId}`
    );
  }

  if (task.state !== 'HUMAN_REVIEW') {
    throw new OrchestrationError(
      'execution_not_reviewable',
      `Task ${task.id} is not awaiting human review (current state: ${task.state})`
    );
  }

  if (persistence.humanReviewDecisions.findByExecutionId(input.executionId) !== null) {
    throw new OrchestrationError('review_already_decided', `Execution ${input.executionId} already has a human review decision`);
  }

  const nextState = input.decision === 'APPROVED' ? 'DONE' : 'PLANNING';
  if (!canTransition(task.state, nextState)) {
    // Defensive only: the HUMAN_REVIEW check above already guarantees this holds today.
    // Domain remains the sole authority on transition legality, so this is checked, not assumed.
    throw new OrchestrationError('workflow_transition_failed', `Invalid transition for task ${task.id}: ${task.state} -> ${nextState}`);
  }

  const decidedAt = now();
  const review: HumanReviewDecision = {
    id: randomUUID(),
    executionId: input.executionId,
    taskId: input.taskId,
    decision: input.decision,
    comment: input.comment,
    decidedAt
  };

  const updatedTask: Task = transitionTask(task, nextState, decidedAt);

  // Mirrors WorkflowEngine.transition()'s own terminal-state mapping: only DONE is
  // terminal from HUMAN_REVIEW here (PLANNING is not) — see domain/task.ts's TaskState
  // and workflow-engine/src/engine.ts's TERMINAL_TASK_STATES for the same rule.
  const isTerminal = nextState === 'DONE';
  const updatedExecution: WorkflowExecution = {
    ...execution,
    status: isTerminal ? 'COMPLETED' : execution.status,
    completedAt: isTerminal ? decidedAt : execution.completedAt
  };

  try {
    persistence.transaction(() => {
      persistence.humanReviewDecisions.create(review);
      persistence.tasks.update(updatedTask);
      persistence.workflowExecutions.update(updatedExecution);
    });
  } catch (error) {
    throw new OrchestrationError(
      'workflow_transition_failed',
      `Failed to persist human review decision for execution ${input.executionId}`,
      { cause: error }
    );
  }

  try {
    await publisher.publish({
      id: randomUUID(),
      taskId: input.taskId,
      workflowExecutionId: input.executionId,
      occurredAt: decidedAt,
      type: input.decision === 'APPROVED' ? 'HUMAN_REVIEW_APPROVED' : 'HUMAN_REVIEW_REJECTED',
      comment: input.comment
    });
  } catch (error) {
    // The decision and transition are already committed by this point (see above) — this
    // failure means only the event stream diverged, the same documented, accepted gap
    // WorkflowEngine.transition() itself has (see its own publish() doc comment).
    throw new OrchestrationError(
      'workflow_transition_failed',
      `Human review for execution ${input.executionId} was recorded, but publishing its event failed`,
      { cause: error }
    );
  }

  return { task: updatedTask, workflowExecution: updatedExecution, review };
}
