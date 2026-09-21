export type OrchestrationErrorKind =
  | 'task_not_found'
  | 'workflow_start_failed'
  | 'context_build_failed'
  /** Phase 21 — execute(): the task's repositoryId does not resolve to an openable repository (deleted/moved since registration, or never registered). */
  | 'repository_unavailable'
  | 'architect_failed'
  | 'worktree_creation_failed'
  | 'developer_failed'
  | 'qa_failed'
  | 'workflow_transition_failed'
  | 'cleanup_failed'
  /** Phase 16 — reviewExecution(): the WorkflowExecution referenced by a review decision does not exist. */
  | 'execution_not_found'
  /** Phase 16 — reviewExecution(): the execution does not belong to the given task. */
  | 'execution_task_mismatch'
  /** Phase 16 — reviewExecution(): the task is not currently in HUMAN_REVIEW. */
  | 'execution_not_reviewable'
  /** Phase 16 — reviewExecution(): this execution already has a recorded human review decision. */
  | 'review_already_decided';

/**
 * Thrown only for infrastructure-level failures that prevent completing
 * the execution flow at all. Reaching a modeled FSM stopping point
 * (BLOCKED, HUMAN_REVIEW, FAILED via a normal agent failure) is NOT one of
 * these — those are returned as a normal `OrchestrationResult`, since the
 * pipeline worked correctly by reaching them. `cause` preserves the
 * underlying normalized error (from git-integration/context-engine/
 * agent-runtime/workflow-engine) — never a raw provider SDK error, never a
 * secret.
 */
export class OrchestrationError extends Error {
  readonly kind: OrchestrationErrorKind;

  constructor(kind: OrchestrationErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OrchestrationError';
    this.kind = kind;
  }
}
