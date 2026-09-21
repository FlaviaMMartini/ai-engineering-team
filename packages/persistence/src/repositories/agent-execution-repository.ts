import type Database from 'better-sqlite3';
import type {
  AgentExecution,
  AgentExecutionArtifact,
  AgentExecutionArtifactKind,
  AgentExecutionId,
  AgentExecutionStatus,
  AgentRole,
  LLMRequestId,
  TaskId,
  WorkflowExecutionId
} from '@aet/domain';
import { NotFoundError, translateSqliteError } from '../errors.js';

export interface AgentExecutionRow {
  id: string;
  task_id: string;
  workflow_execution_id: string;
  agent_role: string;
  status: string;
  retry_number: number;
  started_at: string;
  completed_at: string | null;
  output_artifact_kind: string | null;
  output_artifact_data: string | null;
  error_message: string | null;
}

export function agentExecutionToRow(execution: AgentExecution): AgentExecutionRow {
  return {
    id: execution.id,
    task_id: execution.taskId,
    workflow_execution_id: execution.workflowExecutionId,
    agent_role: execution.agentRole,
    status: execution.status,
    retry_number: execution.retryNumber,
    started_at: execution.startedAt,
    completed_at: execution.completedAt,
    output_artifact_kind: execution.outputArtifact?.kind ?? null,
    output_artifact_data: execution.outputArtifact === null ? null : JSON.stringify(execution.outputArtifact.data),
    error_message: execution.errorMessage
  };
}

/**
 * `llmRequestIds` is not stored on this row — it's derived from
 * llm_requests.agent_execution_id (the foreign key already carries this
 * relationship; duplicating it here would be a second source of truth that
 * could drift). Callers pass it in from a separate query.
 */
export function rowToAgentExecution(row: AgentExecutionRow, llmRequestIds: readonly LLMRequestId[]): AgentExecution {
  const outputArtifact: AgentExecutionArtifact | null =
    row.output_artifact_kind === null || row.output_artifact_data === null
      ? null
      : { kind: row.output_artifact_kind as AgentExecutionArtifactKind, data: JSON.parse(row.output_artifact_data) as Record<string, unknown> };

  return {
    id: row.id,
    taskId: row.task_id,
    workflowExecutionId: row.workflow_execution_id,
    agentRole: row.agent_role as AgentRole,
    status: row.status as AgentExecutionStatus,
    retryNumber: row.retry_number,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    llmRequestIds,
    outputArtifact,
    errorMessage: row.error_message
  };
}

export interface AgentExecutionRepository {
  create(execution: AgentExecution): void;
  findById(id: AgentExecutionId): AgentExecution | null;
  findByTaskId(taskId: TaskId): readonly AgentExecution[];
  /** Scoped to one workflow execution — unlike findByTaskId, which spans every execution the task has ever had (e.g. across retried task runs). Added for Phase 14's execution read model. */
  findByWorkflowExecutionId(workflowExecutionId: WorkflowExecutionId): readonly AgentExecution[];
  update(execution: AgentExecution): void;
}

const INSERT_SQL = `
  INSERT INTO agent_executions (
    id, task_id, workflow_execution_id, agent_role, status, retry_number, started_at, completed_at,
    output_artifact_kind, output_artifact_data, error_message
  ) VALUES (
    @id, @task_id, @workflow_execution_id, @agent_role, @status, @retry_number, @started_at, @completed_at,
    @output_artifact_kind, @output_artifact_data, @error_message
  )
`;

const UPDATE_SQL = `
  UPDATE agent_executions
  SET status = @status, completed_at = @completed_at, output_artifact_kind = @output_artifact_kind,
      output_artifact_data = @output_artifact_data, error_message = @error_message
  WHERE id = @id
`;

export class SqliteAgentExecutionRepository implements AgentExecutionRepository {
  constructor(private readonly db: Database.Database) {}

  private llmRequestIdsFor(agentExecutionId: AgentExecutionId): readonly LLMRequestId[] {
    const rows = this.db
      .prepare<[AgentExecutionId], { id: string }>('SELECT id FROM llm_requests WHERE agent_execution_id = ? ORDER BY started_at ASC')
      .all(agentExecutionId);
    return rows.map((row) => row.id);
  }

  create(execution: AgentExecution): void {
    try {
      this.db.prepare<AgentExecutionRow>(INSERT_SQL).run(agentExecutionToRow(execution));
    } catch (error) {
      translateSqliteError(error, 'AgentExecution', execution.id);
    }
  }

  findById(id: AgentExecutionId): AgentExecution | null {
    const row = this.db.prepare<[AgentExecutionId], AgentExecutionRow>('SELECT * FROM agent_executions WHERE id = ?').get(id);
    return row === undefined ? null : rowToAgentExecution(row, this.llmRequestIdsFor(id));
  }

  findByTaskId(taskId: TaskId): readonly AgentExecution[] {
    const rows = this.db
      .prepare<[TaskId], AgentExecutionRow>('SELECT * FROM agent_executions WHERE task_id = ? ORDER BY started_at ASC')
      .all(taskId);
    return rows.map((row) => rowToAgentExecution(row, this.llmRequestIdsFor(row.id)));
  }

  findByWorkflowExecutionId(workflowExecutionId: WorkflowExecutionId): readonly AgentExecution[] {
    const rows = this.db
      .prepare<[WorkflowExecutionId], AgentExecutionRow>(
        'SELECT * FROM agent_executions WHERE workflow_execution_id = ? ORDER BY started_at ASC'
      )
      .all(workflowExecutionId);
    return rows.map((row) => rowToAgentExecution(row, this.llmRequestIdsFor(row.id)));
  }

  update(execution: AgentExecution): void {
    const result = this.db
      .prepare<{
        id: string;
        status: string;
        completed_at: string | null;
        output_artifact_kind: string | null;
        output_artifact_data: string | null;
        error_message: string | null;
      }>(UPDATE_SQL)
      .run({
        id: execution.id,
        status: execution.status,
        completed_at: execution.completedAt,
        output_artifact_kind: execution.outputArtifact?.kind ?? null,
        output_artifact_data: execution.outputArtifact === null ? null : JSON.stringify(execution.outputArtifact.data),
        error_message: execution.errorMessage
      });
    if (result.changes === 0) {
      throw new NotFoundError('AgentExecution', execution.id);
    }
  }
}
