import type { AgentExecution, LLMRequest, Task, TokenBudget, WorkflowExecution } from '@aet/domain';
import { ZERO_TOKEN_USAGE } from '@aet/domain';
import type { ContextMetricRecord } from './repositories/context-metric-repository.js';

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    repositoryId: 'repo-1',
    description: 'Implement JWT authentication',
    state: 'BACKLOG',
    branchName: null,
    retryCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

export function makeBudget(overrides: Partial<TokenBudget> = {}): TokenBudget {
  return {
    taskId: 'task-1',
    maxTokens: 100_000,
    maxCost: null,
    currency: 'USD',
    estimatedUsage: ZERO_TOKEN_USAGE,
    actualUsage: ZERO_TOKEN_USAGE,
    estimatedCost: null,
    calculatedCost: null,
    ...overrides
  };
}

export function makeWorkflowExecution(overrides: Partial<WorkflowExecution> = {}): WorkflowExecution {
  return {
    id: 'wfe-1',
    taskId: 'task-1',
    status: 'RUNNING',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    ...overrides
  };
}

export function makeAgentExecution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    id: 'agent-exec-1',
    taskId: 'task-1',
    workflowExecutionId: 'wfe-1',
    agentRole: 'ARCHITECT',
    status: 'RUNNING',
    retryNumber: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    llmRequestIds: [],
    outputArtifact: null,
    errorMessage: null,
    ...overrides
  };
}

export function makeLLMRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    id: 'llm-req-1',
    taskId: 'task-1',
    agentExecutionId: 'agent-exec-1',
    provider: 'anthropic',
    providerModel: 'claude-sonnet-5',
    purpose: 'PLAN',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    normalizedUsage: ZERO_TOKEN_USAGE,
    providerReportedUsage: null,
    cost: null,
    ...overrides
  };
}

export function makeContextMetricRecord(overrides: Partial<ContextMetricRecord> = {}): ContextMetricRecord {
  return {
    id: 'ctx-metric-1',
    taskId: 'task-1',
    workflowExecutionId: 'wfe-1',
    metric: {
      filesScanned: 340,
      filesSelected: 12,
      relevanceScores: [{ filePath: 'src/auth.ts', score: 0.9 }],
      estimatedFullRepositoryTokens: 500_000,
      estimatedSelectedContextTokens: 45_000
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}
