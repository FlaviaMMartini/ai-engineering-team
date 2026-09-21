import type {
  ContextExpansionBudgetImpact,
  ContextExpansionDecision,
  HumanReviewDecision,
  HumanReviewDecisionType,
  Task,
  TaskId,
  WorkflowExecution,
  WorkflowExecutionId
} from '@aet/domain';
import type { ArchitectPlan, ContextExpansionProposal, DeveloperOutput, QAResult } from '@aet/agent-runtime';
import type { AiWorktree } from '@aet/git-integration';
import type { TaskTokenMetrics } from '@aet/token-intelligence';

export interface ExecuteTaskInput {
  taskId: TaskId;
  /** Identifies this attempt at running the task — see @aet/domain's WorkflowExecution / DOMAIN_MODEL.md. Caller-supplied, same determinism convention as every other id crossing a package boundary in this codebase. */
  executionId: WorkflowExecutionId;
  maxContextTokens: number;
}

/**
 * `human_review_required`/`context_expansion_required`/`blocked`/`failed`
 * are all legitimate, modeled stopping points the FSM already defines —
 * reaching one is the pipeline working correctly, not this method
 * malfunctioning, so they're returned, never thrown. Only infrastructure
 * problems that prevent completing the flow at all (see errors.ts) are
 * thrown as `OrchestrationError`.
 */
export type OrchestrationOutcome = 'human_review_required' | 'context_expansion_required' | 'blocked' | 'failed';

/**
 * What the Orchestrator evaluated about a Developer's context-expansion
 * proposal, using Context Engine's own already-computed candidate list
 * (see context-expansion.ts) and Token Intelligence's budget status. This
 * now DOES include an automatic decision (APPROVED/PARTIAL/DENIED, matching
 * domain's `ContextExpansionDecision`) — completing the flow AGENT_DESIGN.md
 * describes: Context Engine + Token Intelligence decide, Orchestrator
 * resumes the same execution with the approved files (see orchestrator.ts's
 * main loop). Still deliberately not domain's own `ContextExpansionRequest`
 * — this evaluation is never persisted as its own record in this phase,
 * only carried through the in-memory execution and returned in
 * `OrchestrationResult` for observability.
 */
export interface EvaluatedContextExpansion {
  proposal: ContextExpansionProposal;
  /** Requested paths that Context Engine actually scanned and could estimate. */
  filesFound: readonly string[];
  /** Requested paths Context Engine never discovered in the repository at all — most commonly because they are new files the Developer should just create, not read. */
  filesNotFound: readonly string[];
  /** Exactly `filesFound` when the decision is APPROVED or PARTIAL, and empty when DENIED — see context-expansion.ts. */
  filesApproved: readonly string[];
  /**
   * Requested paths that the ARCHITECT'S OWN plan already lists under
   * `filesToCreate` — a Developer confusion, not a legitimate context gap
   * (see context-expansion.ts and developer.ts's PriorContextExpansionOutcome):
   * a file the plan authorizes creating does not exist yet, so there is
   * nothing to "read" — it should just be written.
   */
  filesAlreadyPlannedToCreate: readonly string[];
  decision: ContextExpansionDecision;
  estimatedAdditionalTokens: number;
  budgetImpact: ContextExpansionBudgetImpact;
}

export interface OrchestrationResult {
  outcome: OrchestrationOutcome;
  task: Task;
  workflowExecution: WorkflowExecution;
  architectPlan: ArchitectPlan | null;
  developerOutput: DeveloperOutput | null;
  qaResult: QAResult | null;
  /** Non-null whenever the worktree was kept (human review pending, or context expansion pending) — null once cleaned up on failure. */
  worktree: AiWorktree | null;
  evaluatedContextExpansion: EvaluatedContextExpansion | null;
  taskTokenMetrics: TaskTokenMetrics | null;
  /** Populated for 'blocked'/'failed' outcomes; null otherwise. */
  errorMessage: string | null;
}

/**
 * The one human decision this platform recognizes: "the human reviewed the
 * AI execution result and approved/rejected it." Never Git merge/push — see
 * review.ts's doc comment. `taskId` is required (not resolved implicitly
 * from `executionId`) so execution/task ownership can be verified rather
 * than assumed — see review.ts's `execution_task_mismatch` check.
 */
export interface ReviewExecutionInput {
  executionId: WorkflowExecutionId;
  taskId: TaskId;
  decision: HumanReviewDecisionType;
  comment: string | null;
}

export interface HumanReviewResult {
  task: Task;
  workflowExecution: WorkflowExecution;
  review: HumanReviewDecision;
}

/**
 * Structurally mirrors git-integration's `WorktreeDiffFileStatus` — an
 * independent type per this codebase's "structural non-coupling"
 * convention (see read-model/types.ts's own doc comment on the same
 * pattern), not a re-export.
 */
export type ExecutionDiffFileStatus = 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'COPIED' | 'UNKNOWN';

export interface ExecutionDiffFile {
  path: string;
  status: ExecutionDiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** Null for binary files, and null for every file when `ExecutionDiff.truncated` is true. */
  patch: string | null;
}

/**
 * A read-only, review-ready diff for one execution — see diff.ts. `files`
 * is empty and every field is otherwise honest (not fabricated) when the
 * worktree has no changes; the whole result is `null` (not this type) when
 * no worktree is available at all — see `Orchestrator.getExecutionDiff()`.
 */
export interface ExecutionDiff {
  executionId: WorkflowExecutionId;
  files: readonly ExecutionDiffFile[];
  additions: number;
  deletions: number;
  /** True when the diff exceeded the configured size limit — `patch` is withheld (null) on every file, but the file list/stats above remain accurate. */
  truncated: boolean;
}

export interface Orchestrator {
  execute(input: ExecuteTaskInput): Promise<OrchestrationResult>;
  getStatus(executionId: WorkflowExecutionId): Promise<WorkflowExecution | null>;
  reviewExecution(input: ReviewExecutionInput): Promise<HumanReviewResult>;
  /**
   * A pure query — see diff.ts. Never mutates workflow state, never calls
   * reviewExecution()/agent runtime/Context Engine/LLMs, never creates or
   * deletes a worktree. Returns null when the execution exists but has no
   * resolvable worktree (never created, or no longer available) — see
   * diff.ts for the distinction from a thrown `execution_not_found`.
   */
  getExecutionDiff(executionId: WorkflowExecutionId): Promise<ExecutionDiff | null>;
}
