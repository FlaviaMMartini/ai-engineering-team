import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForeignKeyViolationError, NotFoundError } from '../errors.js';
import { createPersistence, type Persistence } from '../persistence.js';
import { makeAgentExecution, makeBudget, makeLLMRequest, makeTask, makeWorkflowExecution } from '../test-fixtures.js';

let persistence: Persistence;

beforeEach(() => {
  persistence = createPersistence(':memory:');
  persistence.tasks.create(makeTask(), makeBudget());
  persistence.workflowExecutions.create(makeWorkflowExecution());
});

afterEach(() => {
  persistence.close();
});

describe('SqliteAgentExecutionRepository', () => {
  it('creates and reads back an agent execution with no LLM requests yet', () => {
    const execution = makeAgentExecution();
    persistence.agentExecutions.create(execution);
    expect(persistence.agentExecutions.findById(execution.id)).toEqual(execution);
  });

  it('derives llmRequestIds from llm_requests.agent_execution_id rather than a stored column', () => {
    const execution = makeAgentExecution();
    persistence.agentExecutions.create(execution);
    persistence.llmRequests.create(makeLLMRequest({ id: 'req-a', startedAt: '2026-01-01T00:00:00.000Z' }));
    persistence.llmRequests.create(makeLLMRequest({ id: 'req-b', startedAt: '2026-01-01T00:01:00.000Z' }));

    expect(persistence.agentExecutions.findById(execution.id)?.llmRequestIds).toEqual(['req-a', 'req-b']);
  });

  it('rejects an agent execution referencing a workflow execution that does not exist', () => {
    expect(() =>
      persistence.agentExecutions.create(makeAgentExecution({ id: 'ae-x', workflowExecutionId: 'missing-wfe' }))
    ).toThrow(ForeignKeyViolationError);
  });

  it('round-trips a non-null output artifact', () => {
    const execution = makeAgentExecution({
      status: 'SUCCEEDED',
      completedAt: '2026-01-02T00:00:00.000Z',
      outputArtifact: { kind: 'PLAN', data: { steps: ['add JWT middleware'], complexity: 'MEDIUM' } }
    });
    persistence.agentExecutions.create(execution);
    expect(persistence.agentExecutions.findById(execution.id)).toEqual(execution);
  });

  it('updates status, completedAt, and output artifact', () => {
    const execution = makeAgentExecution();
    persistence.agentExecutions.create(execution);

    const completed = {
      ...execution,
      status: 'SUCCEEDED' as const,
      completedAt: '2026-01-02T00:00:00.000Z',
      outputArtifact: { kind: 'PLAN' as const, data: { steps: [] } }
    };
    persistence.agentExecutions.update(completed);

    expect(persistence.agentExecutions.findById(execution.id)).toEqual(completed);
  });

  it('throws NotFoundError updating an agent execution that does not exist', () => {
    expect(() => persistence.agentExecutions.update(makeAgentExecution({ id: 'missing' }))).toThrow(NotFoundError);
  });

  it('lists agent executions for a task in start order', () => {
    persistence.agentExecutions.create(makeAgentExecution({ id: 'ae-1', startedAt: '2026-01-01T00:00:00.000Z' }));
    persistence.agentExecutions.create(
      makeAgentExecution({ id: 'ae-2', agentRole: 'DEVELOPER', startedAt: '2026-01-01T00:05:00.000Z' })
    );
    expect(persistence.agentExecutions.findByTaskId('task-1').map((e) => e.id)).toEqual(['ae-1', 'ae-2']);
  });
});
