import { estimatedContextAvoided } from '@aet/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openConnection } from '../db/connection.js';
import { ForeignKeyViolationError } from '../errors.js';
import { createPersistence, type Persistence } from '../persistence.js';
import { makeBudget, makeContextMetricRecord, makeTask, makeWorkflowExecution } from '../test-fixtures.js';
import { SqliteContextMetricRepository } from './context-metric-repository.js';

let persistence: Persistence;

beforeEach(() => {
  persistence = createPersistence(':memory:');
  persistence.tasks.create(makeTask(), makeBudget());
  persistence.workflowExecutions.create(makeWorkflowExecution());
});

afterEach(() => {
  persistence.close();
});

describe('SqliteContextMetricRepository', () => {
  it('creates and reads back a context metric record', () => {
    const record = makeContextMetricRecord();
    persistence.contextMetrics.create(record);
    expect(persistence.contextMetrics.findById(record.id)).toEqual(record);
  });

  it('preserves the relevance scores array exactly', () => {
    const record = makeContextMetricRecord({
      metric: {
        filesScanned: 10,
        filesSelected: 2,
        relevanceScores: [
          { filePath: 'a.ts', score: 0.95 },
          { filePath: 'b.ts', score: 0.4 }
        ],
        estimatedFullRepositoryTokens: 1000,
        estimatedSelectedContextTokens: 200
      }
    });
    persistence.contextMetrics.create(record);
    expect(persistence.contextMetrics.findById(record.id)?.metric.relevanceScores).toEqual(record.metric.relevanceScores);
  });

  it('allows a null workflowExecutionId', () => {
    const record = makeContextMetricRecord({ workflowExecutionId: null });
    persistence.contextMetrics.create(record);
    expect(persistence.contextMetrics.findById(record.id)?.workflowExecutionId).toBeNull();
  });

  it('rejects a context metric referencing a task that does not exist', () => {
    expect(() =>
      persistence.contextMetrics.create(makeContextMetricRecord({ id: 'cm-x', taskId: 'missing-task' }))
    ).toThrow(ForeignKeyViolationError);
  });

  it('finds context metrics by task id in creation order', () => {
    persistence.contextMetrics.create(makeContextMetricRecord({ id: 'cm-1', createdAt: '2026-01-01T00:00:00.000Z' }));
    persistence.contextMetrics.create(makeContextMetricRecord({ id: 'cm-2', createdAt: '2026-01-01T00:01:00.000Z' }));
    expect(persistence.contextMetrics.findByTaskId('task-1').map((r) => r.id)).toEqual(['cm-1', 'cm-2']);
  });

  it("the database's GENERATED context_avoided column matches the domain's own subtraction formula", () => {
    const db = openConnection(':memory:');
    db.prepare(
      `INSERT INTO tasks (id, project_id, repository_id, description, state, retry_count, currency, created_at, updated_at)
       VALUES ('task-1', 'p1', 'r1', 'desc', 'BACKLOG', 0, 'USD', 'now', 'now')`
    ).run();

    const repo = new SqliteContextMetricRepository(db);
    const record = makeContextMetricRecord({ workflowExecutionId: null });
    repo.create(record);

    const row = db
      .prepare<[string], { context_avoided: number }>('SELECT context_avoided FROM context_metrics WHERE id = ?')
      .get(record.id);

    expect(row?.context_avoided).toBe(estimatedContextAvoided(record.metric));
    db.close();
  });
});
