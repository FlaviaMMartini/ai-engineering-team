import type Database from 'better-sqlite3';
import type { TaskId, WorkflowExecutionId } from '@aet/domain';
import { translateSqliteError } from '../errors.js';

/**
 * Durable association between one WorkflowExecution and the isolated AI
 * worktree/branch the pipeline created for it (Phase 17). `@aet/domain` has
 * no notion of a filesystem path or git branch beyond `Task.branchName`
 * (never actually populated by the pipeline today) — this is a
 * persistence-owned wrapper, exactly like `ContextMetricRecord`, not a
 * domain type, since a worktree path/branch/base commit are infrastructure
 * facts, not domain concepts. `baseCommitSha` is persisted because
 * `AiWorktree` needs it to diff against — without it, a later request could
 * not reconstruct a working `AiWorktree` handle at all.
 */
export interface ExecutionWorktreeRecord {
  executionId: WorkflowExecutionId;
  taskId: TaskId;
  worktreePath: string;
  branchName: string;
  baseCommitSha: string;
  createdAt: string;
}

export interface ExecutionWorktreeRow {
  workflow_execution_id: string;
  task_id: string;
  worktree_path: string;
  branch_name: string;
  base_commit_sha: string;
  created_at: string;
}

export function executionWorktreeToRow(record: ExecutionWorktreeRecord): ExecutionWorktreeRow {
  return {
    workflow_execution_id: record.executionId,
    task_id: record.taskId,
    worktree_path: record.worktreePath,
    branch_name: record.branchName,
    base_commit_sha: record.baseCommitSha,
    created_at: record.createdAt
  };
}

export function rowToExecutionWorktree(row: ExecutionWorktreeRow): ExecutionWorktreeRecord {
  return {
    executionId: row.workflow_execution_id,
    taskId: row.task_id,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    baseCommitSha: row.base_commit_sha,
    createdAt: row.created_at
  };
}

/**
 * Deliberately minimal: no update()/delete(). A worktree's recorded
 * coordinates never change after creation, and this table is keyed by
 * `workflow_execution_id` (not `task_id`) precisely because a task can
 * have more than one execution over its lifetime (e.g. after a Phase 16
 * HUMAN_REVIEW -> PLANNING rejection) — each gets its own row, its own
 * worktree, and its own branch (Phase 18; see git-integration's
 * createWorktree(), which now keys the path/branch by execution sequence
 * rather than task id alone).
 */
export interface ExecutionWorktreeRepository {
  create(record: ExecutionWorktreeRecord): void;
  findByExecutionId(executionId: WorkflowExecutionId): ExecutionWorktreeRecord | null;
}

const INSERT_SQL = `
  INSERT INTO execution_worktrees (workflow_execution_id, task_id, worktree_path, branch_name, base_commit_sha, created_at)
  VALUES (@workflow_execution_id, @task_id, @worktree_path, @branch_name, @base_commit_sha, @created_at)
`;

export class SqliteExecutionWorktreeRepository implements ExecutionWorktreeRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ExecutionWorktreeRecord): void {
    try {
      this.db.prepare<ExecutionWorktreeRow>(INSERT_SQL).run(executionWorktreeToRow(record));
    } catch (error) {
      translateSqliteError(error, 'ExecutionWorktree', record.executionId);
    }
  }

  findByExecutionId(executionId: WorkflowExecutionId): ExecutionWorktreeRecord | null {
    const row = this.db
      .prepare<[WorkflowExecutionId], ExecutionWorktreeRow>('SELECT * FROM execution_worktrees WHERE workflow_execution_id = ?')
      .get(executionId);
    return row === undefined ? null : rowToExecutionWorktree(row);
  }
}
