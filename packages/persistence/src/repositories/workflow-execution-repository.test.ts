import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForeignKeyViolationError, NotFoundError } from '../errors.js';
import { createPersistence, type Persistence } from '../persistence.js';
import { makeBudget, makeTask, makeWorkflowExecution } from '../test-fixtures.js';

let persistence: Persistence;

beforeEach(() => {
  persistence = createPersistence(':memory:');
  persistence.tasks.create(makeTask(), makeBudget());
});

afterEach(() => {
  persistence.close();
});

describe('SqliteWorkflowExecutionRepository', () => {
  it('creates and reads back a workflow execution', () => {
    const execution = makeWorkflowExecution();
    persistence.workflowExecutions.create(execution);
    expect(persistence.workflowExecutions.findById(execution.id)).toEqual(execution);
  });

  it('rejects a workflow execution referencing a task that does not exist', () => {
    expect(() =>
      persistence.workflowExecutions.create(makeWorkflowExecution({ id: 'wfe-x', taskId: 'missing-task' }))
    ).toThrow(ForeignKeyViolationError);
  });

  it('lists workflow executions for a task in start order', () => {
    persistence.workflowExecutions.create(makeWorkflowExecution({ id: 'wfe-1', startedAt: '2026-01-01T00:00:00.000Z' }));
    persistence.workflowExecutions.create(makeWorkflowExecution({ id: 'wfe-2', startedAt: '2026-01-02T00:00:00.000Z' }));
    expect(persistence.workflowExecutions.findByTaskId('task-1').map((e) => e.id)).toEqual(['wfe-1', 'wfe-2']);
  });

  it('updates status and completedAt', () => {
    const execution = makeWorkflowExecution();
    persistence.workflowExecutions.create(execution);

    const completed = { ...execution, status: 'COMPLETED' as const, completedAt: '2026-01-02T00:00:00.000Z' };
    persistence.workflowExecutions.update(completed);

    expect(persistence.workflowExecutions.findById(execution.id)).toEqual(completed);
  });

  it('throws NotFoundError updating a workflow execution that does not exist', () => {
    expect(() => persistence.workflowExecutions.update(makeWorkflowExecution({ id: 'missing' }))).toThrow(NotFoundError);
  });
});
