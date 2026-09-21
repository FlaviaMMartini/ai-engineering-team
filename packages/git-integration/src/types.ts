export interface RepositoryDescriptor {
  /** Canonical (symlink-resolved) absolute path to the repository root. */
  path: string;
  defaultBranch: string;
}

/**
 * Reports state only — this package never decides whether a dirty
 * repository is safe to proceed with. That policy call belongs to the
 * future Orchestrator.
 */
export interface RepositoryStatus {
  currentBranch: string | null;
  isClean: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  hasUntrackedFiles: boolean;
}

export interface GitFileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface GitDiff {
  files: readonly GitFileChange[];
  additions: number;
  deletions: number;
  /** Raw `git diff` text, kept available rather than fully parsed. */
  diffText: string;
}

/**
 * Per-file change kind, read directly from git's own diff header for that
 * file (`new file mode` / `deleted file mode` / `rename from`+`rename to` /
 * `copy from`+`copy to`) — never guessed. `UNKNOWN` only if a future git
 * output shape this parser doesn't recognize appears; today every file
 * this package can diff resolves to one of the other five.
 */
export type WorktreeDiffFileStatus = 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'COPIED' | 'UNKNOWN';

/**
 * One file's entry in a `WorktreeDiff` — the read-only, review-oriented
 * structured diff (see `AiWorktree.getStructuredDiff()`). Deliberately a
 * separate type from `GitFileChange`/`GitDiff`: those remain exactly as
 * QA/Developer (agent-runtime) already consume them, unchanged by Phase 17.
 */
export interface WorktreeDiffFile {
  /** Repository-relative path (the diff's "b/" side) — never an absolute filesystem path. */
  path: string;
  status: WorktreeDiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** This file's own unified diff text, or null for binary files — never raw binary bytes. */
  patch: string | null;
}

/**
 * A structured, per-file, review-ready diff for one AiWorktree against the
 * commit it branched from. Distinct from `GitDiff` (which QA/Developer use
 * internally) — this is the shape Phase 17's human-review diff use case
 * consumes, safe to serialize to an HTTP response as-is (every path is
 * already repository-relative; no filesystem or simple-git types leak in).
 */
export interface WorktreeDiff {
  files: readonly WorktreeDiffFile[];
  additions: number;
  deletions: number;
  /** UTF-8 byte length of every non-null `patch` combined — lets a caller apply its own size policy without re-deriving this from `files`. */
  totalBytes: number;
}

export interface CommitResult {
  commitSha: string;
  message: string;
}

interface GitOperationBase {
  occurredAt: string;
}

/**
 * Typed results of Git operations, for the future Orchestrator to turn into
 * WorkflowEvents. Not an event bus — just what each method call returns.
 * WORKTREE_CREATED covers branch creation too, since `git worktree add -b`
 * creates both atomically in one call in this package's implementation.
 */
export type GitOperationResult =
  | (GitOperationBase & { type: 'REPOSITORY_VALIDATED'; repositoryPath: string; defaultBranch: string })
  | (GitOperationBase & {
      type: 'WORKTREE_CREATED';
      taskId: string;
      branchName: string;
      worktreePath: string;
      baseBranch: string;
    })
  | (GitOperationBase & { type: 'FILE_READ'; path: string })
  | (GitOperationBase & { type: 'FILE_WRITTEN'; path: string; bytesWritten: number })
  | (GitOperationBase & { type: 'DIFF_GENERATED'; filesChanged: number; additions: number; deletions: number })
  | (GitOperationBase & { type: 'COMMIT_CREATED'; commitSha: string; message: string })
  | (GitOperationBase & { type: 'WORKTREE_REMOVED'; taskId: string; worktreePath: string });

export type GitOperationType = GitOperationResult['type'];
