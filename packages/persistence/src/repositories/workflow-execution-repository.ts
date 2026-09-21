import type Database from 'better-sqlite3';
import type { TaskId, WorkflowExecution, WorkflowExecutionId, WorkflowExecutionStatus } from '@aet/domain';
import { NotFoundError, translateSqliteError } from '../errors.js';

export interface WorkflowExecutionRow {
  id: string;
  task_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

export function workflowExecutionToRow(execution: WorkflowExecution): WorkflowExecutionRow {
  return {
    id: execution.id,
    task_id: execution.taskId,
    status: execution.status,
    started_at: execution.startedAt,
    completed_at: execution.completedAt
  };
}

export function rowToWorkflowExecution(row: WorkflowExecutionRow): WorkflowExecution {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status as WorkflowExecutionStatus,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export interface WorkflowExecutionRepository {
  create(execution: WorkflowExecution): void;
  findById(id: WorkflowExecutionId): WorkflowExecution | null;
  findByTaskId(taskId: TaskId): readonly WorkflowExecution[];
  update(execution: WorkflowExecution): void;
}

const INSERT_SQL = `
  INSERT INTO workflow_executions (id, task_id, status, started_at, completed_at)
  VALUES (@id, @task_id, @status, @started_at, @completed_at)
`;

const UPDATE_SQL = `
  UPDATE workflow_executions
  SET status = @status, completed_at = @completed_at
  WHERE id = @id
`;

export class SqliteWorkflowExecutionRepository implements WorkflowExecutionRepository {
  constructor(private readonly db: Database.Database) {}

  create(execution: WorkflowExecution): void {
    try {
      this.db.prepare<WorkflowExecutionRow>(INSERT_SQL).run(workflowExecutionToRow(execution));
    } catch (error) {
      translateSqliteError(error, 'WorkflowExecution', execution.id);
    }
  }

  findById(id: WorkflowExecutionId): WorkflowExecution | null {
    const row = this.db
      .prepare<[WorkflowExecutionId], WorkflowExecutionRow>('SELECT * FROM workflow_executions WHERE id = ?')
      .get(id);
    return row === undefined ? null : rowToWorkflowExecution(row);
  }

  findByTaskId(taskId: TaskId): readonly WorkflowExecution[] {
    const rows = this.db
      .prepare<[TaskId], WorkflowExecutionRow>('SELECT * FROM workflow_executions WHERE task_id = ? ORDER BY started_at ASC')
      .all(taskId);
    return rows.map(rowToWorkflowExecution);
  }

  update(execution: WorkflowExecution): void {
    const result = this.db
      .prepare<{ id: string; status: string; completed_at: string | null }>(UPDATE_SQL)
      .run({ id: execution.id, status: execution.status, completed_at: execution.completedAt });
    if (result.changes === 0) {
      throw new NotFoundError('WorkflowExecution', execution.id);
    }
  }
}
