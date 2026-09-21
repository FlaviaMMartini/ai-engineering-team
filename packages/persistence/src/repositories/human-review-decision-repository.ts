import type Database from 'better-sqlite3';
import type { HumanReviewDecision, HumanReviewDecisionType, TaskId, WorkflowExecutionId } from '@aet/domain';
import { translateSqliteError } from '../errors.js';

export interface HumanReviewDecisionRow {
  id: string;
  workflow_execution_id: string;
  task_id: string;
  decision: string;
  comment: string | null;
  decided_at: string;
}

export function humanReviewDecisionToRow(decision: HumanReviewDecision): HumanReviewDecisionRow {
  return {
    id: decision.id,
    workflow_execution_id: decision.executionId,
    task_id: decision.taskId,
    decision: decision.decision,
    comment: decision.comment,
    decided_at: decision.decidedAt
  };
}

export function rowToHumanReviewDecision(row: HumanReviewDecisionRow): HumanReviewDecision {
  return {
    id: row.id,
    executionId: row.workflow_execution_id,
    taskId: row.task_id,
    decision: row.decision as HumanReviewDecisionType,
    comment: row.comment,
    decidedAt: row.decided_at
  };
}

/**
 * Deliberately minimal: exactly the operations Phase 16's review use case
 * needs. No update()/delete() — a decision is immutable once recorded (see
 * domain's HumanReviewDecision doc comment: at most one final decision per
 * execution; reopening a review is explicitly out of scope until a future
 * phase introduces it).
 */
export interface HumanReviewDecisionRepository {
  create(decision: HumanReviewDecision): void;
  findByExecutionId(executionId: WorkflowExecutionId): HumanReviewDecision | null;
  findByTaskId(taskId: TaskId): readonly HumanReviewDecision[];
}

const INSERT_SQL = `
  INSERT INTO human_review_decisions (id, workflow_execution_id, task_id, decision, comment, decided_at)
  VALUES (@id, @workflow_execution_id, @task_id, @decision, @comment, @decided_at)
`;

export class SqliteHumanReviewDecisionRepository implements HumanReviewDecisionRepository {
  constructor(private readonly db: Database.Database) {}

  create(decision: HumanReviewDecision): void {
    try {
      this.db.prepare<HumanReviewDecisionRow>(INSERT_SQL).run(humanReviewDecisionToRow(decision));
    } catch (error) {
      translateSqliteError(error, 'HumanReviewDecision', decision.id);
    }
  }

  findByExecutionId(executionId: WorkflowExecutionId): HumanReviewDecision | null {
    const row = this.db
      .prepare<[WorkflowExecutionId], HumanReviewDecisionRow>('SELECT * FROM human_review_decisions WHERE workflow_execution_id = ?')
      .get(executionId);
    return row === undefined ? null : rowToHumanReviewDecision(row);
  }

  findByTaskId(taskId: TaskId): readonly HumanReviewDecision[] {
    const rows = this.db
      .prepare<[TaskId], HumanReviewDecisionRow>('SELECT * FROM human_review_decisions WHERE task_id = ? ORDER BY decided_at ASC')
      .all(taskId);
    return rows.map(rowToHumanReviewDecision);
  }
}
