import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPersistence, type Persistence } from './persistence.js';
import { makeAgentExecution, makeBudget, makeTask, makeWorkflowExecution } from './test-fixtures.js';

let persistence: Persistence;

beforeEach(() => {
  persistence = createPersistence(':memory:');
});

afterEach(() => {
  persistence.close();
});

describe('Persistence.transaction', () => {
  it('commits every write made inside a successful callback', () => {
    persistence.transaction(() => {
      persistence.tasks.create(makeTask(), makeBudget());
      persistence.workflowExecutions.create(makeWorkflowExecution());
    });

    expect(persistence.tasks.findById('task-1')).not.toBeNull();
    expect(persistence.workflowExecutions.findById('wfe-1')).not.toBeNull();
  });

  it('returns the callback value on commit', () => {
    const result = persistence.transaction(() => {
      persistence.tasks.create(makeTask(), makeBudget());
      return 'created';
    });
    expect(result).toBe('created');
  });

  it('rolls back every write made inside a callback that throws', () => {
    expect(() => {
      persistence.transaction(() => {
        persistence.tasks.create(makeTask(), makeBudget());
        throw new Error('simulated failure mid-transaction');
      });
    }).toThrow('simulated failure mid-transaction');

    expect(persistence.tasks.findById('task-1')).toBeNull();
  });

  it('rolls back the whole transaction atomically, not just the statement that failed', () => {
    persistence.tasks.create(makeTask(), makeBudget());

    expect(() => {
      persistence.transaction(() => {
        persistence.workflowExecutions.create(makeWorkflowExecution({ id: 'wfe-should-not-survive' }));
        persistence.agentExecutions.create(makeAgentExecution({ workflowExecutionId: 'does-not-exist' }));
      });
    }).toThrow();

    expect(persistence.workflowExecutions.findById('wfe-should-not-survive')).toBeNull();
  });

  it('leaves prior committed state untouched when a later transaction rolls back', () => {
    persistence.transaction(() => {
      persistence.tasks.create(makeTask(), makeBudget());
    });

    expect(() => {
      persistence.transaction(() => {
        persistence.workflowExecutions.create(makeWorkflowExecution({ taskId: 'missing-task' }));
      });
    }).toThrow();

    expect(persistence.tasks.findById('task-1')).not.toBeNull();
  });
});
