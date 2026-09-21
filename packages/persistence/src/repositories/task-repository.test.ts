import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuplicateIdError, NotFoundError } from '../errors.js';
import { createPersistence, type Persistence } from '../persistence.js';
import { makeBudget, makeTask } from '../test-fixtures.js';

let persistence: Persistence;

beforeEach(() => {
  persistence = createPersistence(':memory:');
});

afterEach(() => {
  persistence.close();
});

describe('SqliteTaskRepository', () => {
  it('creates and reads back a task', () => {
    const task = makeTask();
    persistence.tasks.create(task, makeBudget());
    expect(persistence.tasks.findById(task.id)).toEqual(task);
  });

  it('round-trips the associated budget, including partially-null usage', () => {
    const task = makeTask();
    const budget = makeBudget({
      maxTokens: 50_000,
      estimatedUsage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: null,
        cacheReadTokens: null,
        totalTokens: 150
      },
      actualUsage: {
        inputTokens: 90,
        outputTokens: 40,
        cacheCreationTokens: 10,
        cacheReadTokens: 5,
        totalTokens: 130
      },
      estimatedCost: 0.01,
      calculatedCost: 0.009
    });
    persistence.tasks.create(task, budget);
    expect(persistence.tasks.findBudgetByTaskId(task.id)).toEqual(budget);
  });

  it('returns null for a task that does not exist', () => {
    expect(persistence.tasks.findById('missing')).toBeNull();
    expect(persistence.tasks.findBudgetByTaskId('missing')).toBeNull();
  });

  it('rejects a duplicate task id', () => {
    const task = makeTask();
    persistence.tasks.create(task, makeBudget());
    expect(() => persistence.tasks.create(task, makeBudget())).toThrow(DuplicateIdError);
  });

  it('updates task state, branch name, and retry count', () => {
    const task = makeTask();
    persistence.tasks.create(task, makeBudget());

    const updated = {
      ...task,
      state: 'PLANNING' as const,
      branchName: 'ai/task-1-jwt-auth',
      retryCount: 1,
      updatedAt: '2026-01-02T00:00:00.000Z'
    };
    persistence.tasks.update(updated);

    expect(persistence.tasks.findById(task.id)).toEqual(updated);
  });

  it('throws NotFoundError updating a task that does not exist', () => {
    expect(() => persistence.tasks.update(makeTask({ id: 'missing' }))).toThrow(NotFoundError);
  });

  it('updates a budget independently of the task fields', () => {
    const task = makeTask();
    persistence.tasks.create(task, makeBudget());

    const updatedBudget = makeBudget({
      actualUsage: { inputTokens: 500, outputTokens: 200, cacheCreationTokens: null, cacheReadTokens: null, totalTokens: 700 },
      calculatedCost: 0.02
    });
    persistence.tasks.updateBudget(updatedBudget);

    expect(persistence.tasks.findBudgetByTaskId(task.id)).toEqual(updatedBudget);
    expect(persistence.tasks.findById(task.id)).toEqual(task);
  });

  it('throws NotFoundError updating a budget for a task that does not exist', () => {
    expect(() => persistence.tasks.updateBudget(makeBudget({ taskId: 'missing' }))).toThrow(NotFoundError);
  });

  it('lists tasks in creation order', () => {
    persistence.tasks.create(makeTask({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }), makeBudget({ taskId: 'a' }));
    persistence.tasks.create(makeTask({ id: 'b', createdAt: '2026-01-02T00:00:00.000Z' }), makeBudget({ taskId: 'b' }));
    expect(persistence.tasks.list().map((task) => task.id)).toEqual(['a', 'b']);
  });
});
