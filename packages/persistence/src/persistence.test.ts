import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPersistence, type Persistence } from './persistence.js';
import {
  makeAgentExecution,
  makeBudget,
  makeContextMetricRecord,
  makeLLMRequest,
  makeTask,
  makeWorkflowExecution
} from './test-fixtures.js';

describe('createPersistence (in-memory)', () => {
  let persistence: Persistence;

  beforeEach(() => {
    persistence = createPersistence(':memory:');
  });

  afterEach(() => {
    persistence.close();
  });

  it('persists a full walking-skeleton chain: task -> workflow execution -> agent execution -> llm request -> context metric', () => {
    persistence.tasks.create(makeTask(), makeBudget());
    persistence.workflowExecutions.create(makeWorkflowExecution());
    persistence.agentExecutions.create(makeAgentExecution());
    persistence.llmRequests.create(makeLLMRequest());
    persistence.contextMetrics.create(makeContextMetricRecord());

    expect(persistence.tasks.findById('task-1')).not.toBeNull();
    expect(persistence.workflowExecutions.findByTaskId('task-1')).toHaveLength(1);
    expect(persistence.agentExecutions.findByTaskId('task-1')).toHaveLength(1);
    expect(persistence.llmRequests.findByTaskId('task-1')).toHaveLength(1);
    expect(persistence.contextMetrics.findByTaskId('task-1')).toHaveLength(1);
    expect(persistence.agentExecutions.findByTaskId('task-1')[0]?.llmRequestIds).toEqual(['llm-req-1']);
  });
});

describe('createPersistence (file-backed)', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aet-persistence-'));
    dbPath = join(dir, 'test.sqlite');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('data survives closing and reopening the database through the public facade', () => {
    const first = createPersistence(dbPath);
    first.tasks.create(makeTask(), makeBudget());
    first.workflowExecutions.create(makeWorkflowExecution());
    first.close();

    const second = createPersistence(dbPath);
    expect(second.tasks.findById('task-1')).toEqual(makeTask());
    expect(second.workflowExecutions.findById('wfe-1')).toEqual(makeWorkflowExecution());
    second.close();
  });
});
