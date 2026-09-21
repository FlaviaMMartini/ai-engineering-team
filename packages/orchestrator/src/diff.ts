import type { RepositoryId, WorkflowExecutionId } from '@aet/domain';
import { WorktreeUnavailableError, type GitRepository } from '@aet/git-integration';
import { OrchestrationError } from './errors.js';
import type { OrchestratorPersistence } from './recording.js';
import type { ExecutionDiff, ExecutionDiffFile } from './types.js';

/**
 * Conservative MVP default — most real AI-generated diffs are far smaller
 * than this. A configurable value, not a hardcoded assumption elsewhere:
 * the only place this number is defined. When exceeded, every file's
 * `patch` is withheld (set to null) but the file list and additions/
 * deletions counts — already known cheaply — are still returned; no
 * pagination, per this phase's "keep it simple" instruction.
 */
const MAX_DIFF_BYTES = 500_000;

/** Only what this use case needs — never the whole Persistence surface, and never `.transaction` (this is read-only). `tasks` is needed only to resolve which repository the execution's task targets (Phase 21: repository selection). */
export type DiffPersistence = Pick<OrchestratorPersistence, 'workflowExecutions' | 'executionWorktrees' | 'tasks'>;

/**
 * Phase 17's one read-only application use case: "give me a safe,
 * structured diff for this execution's isolated AI worktree." Never
 * mutates anything — no Git write operation is reachable from here, and
 * this function never creates, removes, merges, or pushes a worktree/branch.
 *
 * Resolution: WorkflowExecution -> ExecutionWorktreeRecord (Phase 17's
 * durable executionId -> worktree association, since AiWorktree itself is
 * only an in-memory handle — see recording.ts's doc comment) ->
 * `GitRepository.resolveWorktree()` -> `AiWorktree.getStructuredDiff()`.
 * Every step after loading the WorkflowExecution can legitimately be
 * "nothing to show" rather than an error — a task that never reached the
 * point of creating a worktree, or whose worktree was later removed, is
 * not a failure of this query, so those cases return `null` rather than
 * throwing. Only "this executionId doesn't exist at all" throws, matching
 * `reviewExecution()`'s precedent for that same condition.
 */
export async function getExecutionDiff(
  persistence: DiffPersistence,
  createGitRepositoryForTask: (repositoryId: RepositoryId) => Promise<GitRepository>,
  executionId: WorkflowExecutionId
): Promise<ExecutionDiff | null> {
  const execution = persistence.workflowExecutions.findById(executionId);
  if (execution === null) {
    throw new OrchestrationError('execution_not_found', `WorkflowExecution not found: ${executionId}`);
  }

  const record = persistence.executionWorktrees.findByExecutionId(executionId);
  if (record === null) {
    return null;
  }

  // `resolveWorktree()` below only reconstructs an in-memory handle from the already-durable
  // coordinates in `record` — it never touches `gitRepository.path`/`.git` itself — but a
  // `GitRepository` instance is still this call's required shape, so it's resolved consistently
  // with every other repository access in this codebase (see orchestrator.ts's own execute()).
  const task = persistence.tasks.findById(execution.taskId);
  if (task === null) {
    return null;
  }
  const gitRepository = await createGitRepositoryForTask(task.repositoryId);

  const worktree = gitRepository.resolveWorktree({
    taskId: record.taskId,
    branchName: record.branchName,
    worktreePath: record.worktreePath,
    baseCommitSha: record.baseCommitSha
  });

  let structured;
  try {
    ({ diff: structured } = await worktree.getStructuredDiff());
  } catch (error) {
    if (error instanceof WorktreeUnavailableError) {
      return null;
    }
    throw error;
  }

  const truncated = structured.totalBytes > MAX_DIFF_BYTES;
  const files: readonly ExecutionDiffFile[] = structured.files.map((file) => ({
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    patch: truncated ? null : file.patch
  }));

  return {
    executionId,
    files,
    additions: structured.additions,
    deletions: structured.deletions,
    truncated
  };
}
