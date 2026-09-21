import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForeignKeyViolationError, NotFoundError } from '../errors.js';
import { createPersistence, type Persistence } from '../persistence.js';
import { makeAgentExecution, makeBudget, makeLLMRequest, makeTask, makeWorkflowExecution } from '../test-fixtures.js';

let persistence: Persistence;

beforeEach(() => {
  persistence = createPersistence(':memory:');
  persistence.tasks.create(makeTask(), makeBudget());
  persistence.workflowExecutions.create(makeWorkflowExecution());
  persistence.agentExecutions.create(makeAgentExecution());
});

afterEach(() => {
  persistence.close();
});

describe('SqliteLLMRequestRepository', () => {
  it('creates and reads back an in-flight request with no usage/cost yet', () => {
    const request = makeLLMRequest();
    persistence.llmRequests.create(request);
    expect(persistence.llmRequests.findById(request.id)).toEqual(request);
  });

  it('preserves provider-reported raw usage exactly, alongside normalized usage', () => {
    const request = makeLLMRequest({
      completedAt: '2026-01-01T00:05:00.000Z',
      normalizedUsage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheCreationTokens: null,
        cacheReadTokens: 500,
        totalTokens: 1200
      },
      providerReportedUsage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 500,
        a_future_provider_field: 'kept-verbatim'
      }
    });
    persistence.llmRequests.create(request);
    expect(persistence.llmRequests.findById(request.id)).toEqual(request);
  });

  it('never fabricates provider-reported usage — a request that never got one stays null', () => {
    const request = makeLLMRequest({ providerReportedUsage: null });
    persistence.llmRequests.create(request);
    expect(persistence.llmRequests.findById(request.id)?.providerReportedUsage).toBeNull();
  });

  it('preserves calculated cost with currency and pricing version — never "actualCost"', () => {
    const request = makeLLMRequest({
      cost: { estimatedCost: 0.05, calculatedCost: 0.047, pricingVersion: 'anthropic-2026-01', currency: 'USD' }
    });
    persistence.llmRequests.create(request);
    expect(persistence.llmRequests.findById(request.id)?.cost).toEqual(request.cost);
  });

  it('rejects a request referencing an agent execution that does not exist', () => {
    expect(() =>
      persistence.llmRequests.create(makeLLMRequest({ id: 'req-x', agentExecutionId: 'missing-agent-exec' }))
    ).toThrow(ForeignKeyViolationError);
  });

  it('finds requests by agent execution id in start order', () => {
    persistence.llmRequests.create(makeLLMRequest({ id: 'req-1', startedAt: '2026-01-01T00:00:00.000Z' }));
    persistence.llmRequests.create(makeLLMRequest({ id: 'req-2', startedAt: '2026-01-01T00:01:00.000Z' }));
    expect(persistence.llmRequests.findByAgentExecutionId('agent-exec-1').map((r) => r.id)).toEqual(['req-1', 'req-2']);
  });

  it('updates completion fields', () => {
    const request = makeLLMRequest();
    persistence.llmRequests.create(request);

    const completed = {
      ...request,
      completedAt: '2026-01-01T00:05:00.000Z',
      normalizedUsage: {
        inputTokens: 500,
        outputTokens: 100,
        cacheCreationTokens: null,
        cacheReadTokens: null,
        totalTokens: 600
      }
    };
    persistence.llmRequests.update(completed);

    expect(persistence.llmRequests.findById(request.id)).toEqual(completed);
  });

  it('throws NotFoundError updating a request that does not exist', () => {
    expect(() => persistence.llmRequests.update(makeLLMRequest({ id: 'missing' }))).toThrow(NotFoundError);
  });
});
