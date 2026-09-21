import type Database from 'better-sqlite3';
import type { ContextMetric, RelevanceScore, TaskId, WorkflowExecutionId } from '@aet/domain';
import { translateSqliteError } from '../errors.js';

/**
 * `ContextMetric` in @aet/domain is a plain value object (no identity, no
 * taskId) — it's meaningful only nested inside a ContextPack. Persistence
 * needs an identity, a task reference, and a timestamp to store and query
 * one independently, so this wraps it rather than changing the approved
 * domain type.
 */
export interface ContextMetricRecord {
  id: string;
  taskId: TaskId;
  workflowExecutionId: WorkflowExecutionId | null;
  metric: ContextMetric;
  createdAt: string;
}

export interface ContextMetricRow {
  id: string;
  task_id: string;
  workflow_execution_id: string | null;
  files_scanned: number;
  files_selected: number;
  relevance_scores: string;
  estimated_full_repository_tokens: number;
  estimated_selected_context_tokens: number;
  /** SQLite GENERATED ALWAYS column — informational only; domain recomputes this itself, never trusts a stored copy. */
  context_avoided: number;
  created_at: string;
}

export function contextMetricRecordToInsertRow(
  record: ContextMetricRecord
): Omit<ContextMetricRow, 'context_avoided'> {
  return {
    id: record.id,
    task_id: record.taskId,
    workflow_execution_id: record.workflowExecutionId,
    files_scanned: record.metric.filesScanned,
    files_selected: record.metric.filesSelected,
    relevance_scores: JSON.stringify(record.metric.relevanceScores),
    estimated_full_repository_tokens: record.metric.estimatedFullRepositoryTokens,
    estimated_selected_context_tokens: record.metric.estimatedSelectedContextTokens,
    created_at: record.createdAt
  };
}

export function rowToContextMetricRecord(row: ContextMetricRow): ContextMetricRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    workflowExecutionId: row.workflow_execution_id,
    metric: {
      filesScanned: row.files_scanned,
      filesSelected: row.files_selected,
      relevanceScores: JSON.parse(row.relevance_scores) as readonly RelevanceScore[],
      estimatedFullRepositoryTokens: row.estimated_full_repository_tokens,
      estimatedSelectedContextTokens: row.estimated_selected_context_tokens
    },
    createdAt: row.created_at
  };
}

export interface ContextMetricRepository {
  create(record: ContextMetricRecord): void;
  findById(id: string): ContextMetricRecord | null;
  findByTaskId(taskId: TaskId): readonly ContextMetricRecord[];
  /**
   * Scoped to one workflow execution. Returns the most recently created
   * record for that execution (current orchestrator behavior records at
   * most one per execution, but this stays well-defined even if that ever
   * changes) rather than a collection, since callers building a single
   * execution's observability view want "the" context metric for it, not a
   * list. Added for Phase 14's execution read model.
   */
  findByWorkflowExecutionId(workflowExecutionId: WorkflowExecutionId): ContextMetricRecord | null;
}

const INSERT_SQL = `
  INSERT INTO context_metrics (
    id, task_id, workflow_execution_id, files_scanned, files_selected, relevance_scores,
    estimated_full_repository_tokens, estimated_selected_context_tokens, created_at
  ) VALUES (
    @id, @task_id, @workflow_execution_id, @files_scanned, @files_selected, @relevance_scores,
    @estimated_full_repository_tokens, @estimated_selected_context_tokens, @created_at
  )
`;

export class SqliteContextMetricRepository implements ContextMetricRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: ContextMetricRecord): void {
    try {
      this.db.prepare<Omit<ContextMetricRow, 'context_avoided'>>(INSERT_SQL).run(contextMetricRecordToInsertRow(record));
    } catch (error) {
      translateSqliteError(error, 'ContextMetric', record.id);
    }
  }

  findById(id: string): ContextMetricRecord | null {
    const row = this.db.prepare<[string], ContextMetricRow>('SELECT * FROM context_metrics WHERE id = ?').get(id);
    return row === undefined ? null : rowToContextMetricRecord(row);
  }

  findByTaskId(taskId: TaskId): readonly ContextMetricRecord[] {
    const rows = this.db
      .prepare<[TaskId], ContextMetricRow>('SELECT * FROM context_metrics WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId);
    return rows.map(rowToContextMetricRecord);
  }

  findByWorkflowExecutionId(workflowExecutionId: WorkflowExecutionId): ContextMetricRecord | null {
    const row = this.db
      .prepare<[WorkflowExecutionId], ContextMetricRow>(
        'SELECT * FROM context_metrics WHERE workflow_execution_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'
      )
      .get(workflowExecutionId);
    return row === undefined ? null : rowToContextMetricRecord(row);
  }
}
