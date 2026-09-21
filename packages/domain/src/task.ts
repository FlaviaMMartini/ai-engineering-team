import type { ProjectId, RepositoryId, TaskId } from './ids.js';

export type TaskState =
  | 'BACKLOG'
  | 'PLANNING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'QA'
  | 'HUMAN_REVIEW'
  | 'DONE'
  | 'FAILED'
  | 'BLOCKED';

export interface Task {
  id: TaskId;
  projectId: ProjectId;
  repositoryId: RepositoryId;
  description: string;
  state: TaskState;
  /** Set once the Developer's git worktree/branch is created; null before READY -> IN_PROGRESS. */
  branchName: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_MAX_RETRIES = 3;

/**
 * Legal TaskState transitions. Mirrors AGENT_DESIGN.md's transition table
 * with CODE_REVIEW folded out (deferred past the 0.1a walking skeleton — QA
 * passing goes straight to HUMAN_REVIEW; see AGENT_DESIGN.md's "0.1a vs.
 * future" note). Any non-terminal state can also reach FAILED ("any ->
 * unrecoverable error -> FAILED" in AGENT_DESIGN.md). BLOCKED -> PLANNING
 * represents a human resolving the blocker and sending the task back to
 * planning. HUMAN_REVIEW -> DONE is a human approving the execution result;
 * HUMAN_REVIEW -> PLANNING (Phase 16) is a human rejecting it and sending
 * the task back for another planning/execution cycle — a human decision,
 * never automatic (see @aet/domain's HumanReviewDecision and the
 * Orchestrator's `reviewExecution` operation, the only caller of this
 * particular transition).
 */
const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  BACKLOG: ['PLANNING', 'FAILED'],
  PLANNING: ['READY', 'BLOCKED', 'FAILED'],
  READY: ['IN_PROGRESS', 'FAILED'],
  IN_PROGRESS: ['QA', 'FAILED'],
  QA: ['HUMAN_REVIEW', 'IN_PROGRESS', 'FAILED'],
  HUMAN_REVIEW: ['DONE', 'PLANNING', 'IN_PROGRESS', 'FAILED'],
  BLOCKED: ['PLANNING', 'FAILED'],
  DONE: [],
  FAILED: []
};

export class InvalidTaskTransitionError extends Error {
  readonly from: TaskState;
  readonly to: TaskState;

  constructor(from: TaskState, to: TaskState) {
    super(`Invalid task transition: ${from} -> ${to}`);
    this.name = 'InvalidTaskTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

/**
 * Pure state transition: no I/O, no clock reads — the caller supplies
 * `updatedAt` so this function is fully deterministic. A QA -> IN_PROGRESS
 * transition is a Debugger retry and increments retryCount; every other
 * transition leaves it unchanged.
 */
export function transitionTask(task: Task, nextState: TaskState, updatedAt: string): Task {
  if (!canTransition(task.state, nextState)) {
    throw new InvalidTaskTransitionError(task.state, nextState);
  }
  const isQaRetry = task.state === 'QA' && nextState === 'IN_PROGRESS';
  return {
    ...task,
    state: nextState,
    retryCount: isQaRetry ? task.retryCount + 1 : task.retryCount,
    updatedAt
  };
}

export function retriesExhausted(task: Task, maxRetries: number = DEFAULT_MAX_RETRIES): boolean {
  return task.retryCount >= maxRetries;
}
