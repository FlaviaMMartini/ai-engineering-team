import {
  estimatedContextAvoided,
  sumTokenUsage,
  ZERO_TOKEN_USAGE,
  type AgentExecution,
  type HumanReviewDecision,
  type LLMRequest,
  type Task,
  type TaskId,
  type WorkflowExecution,
  type WorkflowExecutionId
} from '@aet/domain';
import type { ContextMetricRecord, Persistence } from '@aet/persistence';
import { summarizeRetryOverhead, type RetryUsageEntry } from '@aet/token-intelligence';
import type {
  AgentExecutionDetails,
  ContextObservability,
  CostObservability,
  ExecutionDetails,
  ExecutionReadModel,
  LLMRequestDetails,
  ReviewSummary,
  TokenObservability
} from './types.js';

/** Only what this read model actually queries — never the whole Persistence surface, and never `.transaction` (this is read-only). */
export type ExecutionReadModelPersistence = Pick<
  Persistence,
  'tasks' | 'workflowExecutions' | 'agentExecutions' | 'llmRequests' | 'contextMetrics' | 'humanReviewDecisions'
>;

function toAgentExecutionDetails(execution: AgentExecution): AgentExecutionDetails {
  return {
    id: execution.id,
    agentRole: execution.agentRole,
    status: execution.status,
    retryNumber: execution.retryNumber,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    llmRequestIds: execution.llmRequestIds,
    outputArtifact: execution.outputArtifact,
    errorMessage: execution.errorMessage
  };
}

function toLLMRequestDetails(request: LLMRequest): LLMRequestDetails {
  return {
    id: request.id,
    agentExecutionId: request.agentExecutionId,
    provider: request.provider,
    model: request.providerModel,
    purpose: request.purpose,
    startedAt: request.startedAt,
    completedAt: request.completedAt,
    normalizedUsage: request.normalizedUsage,
    providerReportedUsage: request.providerReportedUsage,
    estimatedCost: request.cost?.estimatedCost ?? null,
    calculatedCost: request.cost?.calculatedCost ?? null,
    pricingVersion: request.cost?.pricingVersion ?? null,
    currency: request.cost?.currency ?? null
  };
}

function toReviewSummary(decision: HumanReviewDecision | null): ReviewSummary | null {
  if (decision === null) return null;
  return {
    id: decision.id,
    decision: decision.decision,
    comment: decision.comment,
    decidedAt: decision.decidedAt
  };
}

function buildContextObservability(record: ContextMetricRecord | null): ContextObservability | null {
  if (record === null) return null;
  return {
    filesScanned: record.metric.filesScanned,
    filesSelected: record.metric.filesSelected,
    relevanceScores: record.metric.relevanceScores,
    estimatedFullRepositoryTokens: record.metric.estimatedFullRepositoryTokens,
    estimatedSelectedContextTokens: record.metric.estimatedSelectedContextTokens,
    estimatedContextAvoidedTokens: estimatedContextAvoided(record.metric)
  };
}

function aggregateTokens(requests: readonly LLMRequestDetails[]): TokenObservability {
  return {
    actualUsage: requests.reduce((total, request) => sumTokenUsage(total, request.normalizedUsage), ZERO_TOKEN_USAGE)
  };
}

/** Sums a persisted per-request cost field, but only when every request's value is known — otherwise the total is genuinely unknown, not partial. */
function sumKnownOrNull(values: readonly (number | null)[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

function aggregateCost(requests: readonly LLMRequestDetails[]): CostObservability {
  const mostRecentCurrency = [...requests].reverse().find((request) => request.currency !== null)?.currency ?? null;
  return {
    estimated: sumKnownOrNull(requests.map((request) => request.estimatedCost)),
    calculated: sumKnownOrNull(requests.map((request) => request.calculatedCost)),
    currency: mostRecentCurrency
  };
}

/** One RetryUsageEntry per LLM request that belongs to a retried (retryNumber > 0) agent execution — fed into token-intelligence's existing summarizeRetryOverhead(), never a new retry formula. */
function buildRetryEntries(agents: readonly AgentExecutionDetails[], requests: readonly LLMRequestDetails[]): readonly RetryUsageEntry[] {
  const retriedAgentExecutionIds = new Set(agents.filter((agent) => agent.retryNumber > 0).map((agent) => agent.id));
  return requests
    .filter((request) => retriedAgentExecutionIds.has(request.agentExecutionId))
    .map((request) => ({ usage: request.normalizedUsage, calculatedCost: request.calculatedCost }));
}

/** Ascending: startedAt, then id as a deterministic tiebreaker when timestamps are equal. */
function byStartedAtThenId<T extends { startedAt: string; id: string }>(a: T, b: T): number {
  if (a.startedAt !== b.startedAt) return a.startedAt.localeCompare(b.startedAt);
  return a.id.localeCompare(b.id);
}

function buildExecutionDetails(persistence: ExecutionReadModelPersistence, task: Task, execution: WorkflowExecution): ExecutionDetails {
  const agents = persistence.agentExecutions
    .findByWorkflowExecutionId(execution.id)
    .map(toAgentExecutionDetails)
    .slice()
    .sort(byStartedAtThenId);

  const llmRequests = agents
    .flatMap((agent) => persistence.llmRequests.findByAgentExecutionId(agent.id))
    .map(toLLMRequestDetails)
    .sort(byStartedAtThenId);

  const context = buildContextObservability(persistence.contextMetrics.findByWorkflowExecutionId(execution.id));

  return {
    execution,
    task: {
      id: task.id,
      description: task.description,
      status: task.state,
      retryCount: task.retryCount,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    },
    agents,
    llmRequests,
    context,
    tokens: aggregateTokens(llmRequests),
    cost: aggregateCost(llmRequests),
    retries: {
      taskRetryCount: task.retryCount,
      agentExecutionCount: agents.length,
      llmRequestCount: llmRequests.length,
      overhead: summarizeRetryOverhead(buildRetryEntries(agents, llmRequests))
    },
    review: toReviewSummary(persistence.humanReviewDecisions.findByExecutionId(execution.id))
  };
}

function mostRecentlyStarted(executions: readonly WorkflowExecution[]): WorkflowExecution | null {
  if (executions.length === 0) return null;
  return [...executions].sort(byStartedAtThenId).at(-1) ?? null;
}

/**
 * Pure query layer over already-persisted execution data. Never writes,
 * never calls an agent/LLM/Git/Context Engine, never calls
 * Orchestrator.execute() — it only reads through the injected repository
 * contracts, exactly like Orchestrator itself does for its own persistence
 * calls. Complementary to `Orchestrator.getStatus()`, not a replacement for it.
 */
export function createExecutionReadModel(persistence: ExecutionReadModelPersistence): ExecutionReadModel {
  return {
    async getExecution(executionId: WorkflowExecutionId): Promise<ExecutionDetails | null> {
      const execution = persistence.workflowExecutions.findById(executionId);
      if (execution === null) return null;
      const task = persistence.tasks.findById(execution.taskId);
      if (task === null) return null;
      return buildExecutionDetails(persistence, task, execution);
    },
    async getTaskExecution(taskId: TaskId): Promise<ExecutionDetails | null> {
      const task = persistence.tasks.findById(taskId);
      if (task === null) return null;
      const execution = mostRecentlyStarted(persistence.workflowExecutions.findByTaskId(taskId));
      if (execution === null) return null;
      return buildExecutionDetails(persistence, task, execution);
    }
  };
}
