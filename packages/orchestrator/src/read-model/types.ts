import type {
  AgentExecutionArtifact,
  AgentExecutionId,
  AgentExecutionStatus,
  AgentRole,
  Currency,
  HumanReviewDecisionType,
  LLMRequestId,
  LLMRequestPurpose,
  RelevanceScore,
  ReviewId,
  TaskId,
  TaskState,
  TokenUsage,
  WorkflowExecution,
  WorkflowExecutionId
} from '@aet/domain';
import type { RetryOverhead } from '@aet/token-intelligence';

/**
 * The read model's own, read-only projection of one AgentExecution.
 * Structurally identical to @aet/domain's `AgentExecution` today (minus
 * `taskId`/`workflowExecutionId`, redundant once nested under
 * `ExecutionDetails`) — a deliberate independent type per this codebase's
 * "structural non-coupling" convention, not a re-export, so this read
 * model's public contract never changes just because the domain type's
 * internal shape does.
 */
export interface AgentExecutionDetails {
  id: AgentExecutionId;
  agentRole: AgentRole;
  status: AgentExecutionStatus;
  retryNumber: number;
  startedAt: string;
  completedAt: string | null;
  llmRequestIds: readonly LLMRequestId[];
  outputArtifact: AgentExecutionArtifact | null;
  /** Non-null exactly when status is 'FAILED' — see domain's AgentExecution.errorMessage doc comment. */
  errorMessage: string | null;
}

/**
 * One persisted LLM call. `providerReportedUsage` is carried here because
 * it IS already persisted and this is an internal application-layer view —
 * the HTTP transport layer (not this read model) decides whether/how it is
 * safe to expose that field publicly. See http/types.ts.
 */
export interface LLMRequestDetails {
  id: LLMRequestId;
  agentExecutionId: AgentExecutionId;
  provider: string;
  model: string;
  purpose: LLMRequestPurpose;
  startedAt: string;
  completedAt: string | null;
  normalizedUsage: TokenUsage;
  providerReportedUsage: Record<string, unknown> | null;
  estimatedCost: number | null;
  calculatedCost: number | null;
  pricingVersion: string | null;
  currency: Currency | null;
}

/** A direct projection of the persisted ContextMetric for this execution — never recomputed by re-running the Context Engine. */
export interface ContextObservability {
  filesScanned: number;
  filesSelected: number;
  relevanceScores: readonly RelevanceScore[];
  estimatedFullRepositoryTokens: number;
  estimatedSelectedContextTokens: number;
  /** domain's estimatedContextAvoided(metric) — never re-derived with a different formula. */
  estimatedContextAvoidedTokens: number;
}

/** Actual usage aggregated from every persisted LLMRequest belonging to this execution — never an estimate. */
export interface TokenObservability {
  actualUsage: TokenUsage;
}

/**
 * Sums of persisted per-request TokenCost fields. `estimated`/`calculated`
 * are null when there are no LLM requests, or when at least one request's
 * value for that field is unknown — a partial sum would misrepresent a
 * total as complete when it is not. Never a provider-billed figure.
 */
export interface CostObservability {
  estimated: number | null;
  calculated: number | null;
  currency: Currency | null;
}

/** Reuses token-intelligence's summarizeRetryOverhead() — no new retry algorithm or score. */
export interface RetryObservability {
  taskRetryCount: number;
  agentExecutionCount: number;
  llmRequestCount: number;
  overhead: RetryOverhead;
}

/** The Task fields this read model actually has: domain's Task has no "title" field, so none is invented here. */
export interface TaskExecutionSummary {
  id: TaskId;
  description: string;
  status: TaskState;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A direct projection of the persisted HumanReviewDecision for this execution — never inferred or fabricated. */
export interface ReviewSummary {
  id: ReviewId;
  decision: HumanReviewDecisionType;
  comment: string | null;
  decidedAt: string;
}

export interface ExecutionDetails {
  execution: WorkflowExecution;
  task: TaskExecutionSummary;
  /** Chronological: startedAt ascending, id as a deterministic tiebreaker. */
  agents: readonly AgentExecutionDetails[];
  /** Chronological, flattened across every agent execution above. */
  llmRequests: readonly LLMRequestDetails[];
  /** Null when the Context Engine's metric for this execution was never persisted (or the execution never reached that stage). */
  context: ContextObservability | null;
  tokens: TokenObservability;
  cost: CostObservability;
  retries: RetryObservability;
  /** Null until a human has recorded APPROVED/REJECTED for this execution (see @aet/domain's HumanReviewDecision). Phase 16. */
  review: ReviewSummary | null;
}

/**
 * Pure query surface over already-persisted execution data. Implementations
 * MUST NOT mutate persistence, invoke agents/LLMs/Git/Context Engine, or
 * call Orchestrator.execute() — see execution-read-model.ts.
 */
export interface ExecutionReadModel {
  getExecution(executionId: WorkflowExecutionId): Promise<ExecutionDetails | null>;
  /** The task's most recently started execution, or null if the task has none yet. */
  getTaskExecution(taskId: TaskId): Promise<ExecutionDetails | null>;
}
