import type { HumanReviewDecisionType, Task, TokenUsage, WorkflowExecution } from '@aet/domain';
import type { ArchitectPlan, DeveloperOutput, QAResult } from '@aet/agent-runtime';
import type { ExecutionDetails, ExecutionDiff, HumanReviewResult, ReviewSummary } from '@aet/orchestrator';
import type { TaskTokenMetrics } from '@aet/token-intelligence';

// --- Request DTOs ---

export interface CreateTaskRequestBody {
  projectId: string;
  /** Phase 21: optional — omitting it means "no repository selected," which scaffolds a brand-new one (see routes.ts). */
  repositoryId?: string;
  /** Used only when `repositoryId` is omitted, to name the new repository this creates. */
  newRepositoryName?: string;
  description: string;
  maxTokens?: number | null;
  maxCost?: number | null;
}

export interface ExecuteTaskRequestBody {
  maxContextTokens?: number;
}

export interface TaskParams {
  taskId: string;
}

export interface ExecutionParams {
  executionId: string;
}

/**
 * Typed as the domain's closed 2-value union (not `string`, unlike the
 * response-side status fields below) because the JSON schema already
 * enforces `enum: ['APPROVED','REJECTED']` at the request boundary — the
 * route can hand `decision` straight to `Orchestrator.reviewExecution()`
 * without an unsafe cast, and there's no "future value the backend hasn't
 * seen yet" concern the way there is for an evolving state/status field.
 */
export interface ReviewExecutionRequestBody {
  taskId: string;
  decision: HumanReviewDecisionType;
  comment?: string | null;
}

// --- Response DTOs ---
// Stable, transport-owned shapes — never the raw domain/persistence objects.
// `ArchitectPlan`/`DeveloperOutput`/`QAResult`/`TaskTokenMetrics` are reused
// as-is (not redefined): they are already plain, JSON-safe data contracts
// owned by agent-runtime/token-intelligence, so wrapping them in a parallel
// DTO would be duplication for no safety benefit.

export interface TaskDto {
  id: string;
  projectId: string;
  repositoryId: string;
  description: string;
  state: string;
  branchName: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecutionDto {
  id: string;
  taskId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

export interface CreateTaskResponseBody {
  task: TaskDto;
}

export interface ExecuteTaskResponseBody {
  outcome: string;
  task: TaskDto;
  workflowExecution: WorkflowExecutionDto;
  architectPlan: ArchitectPlan | null;
  developerOutput: DeveloperOutput | null;
  qaResult: QAResult | null;
  /** The worktree's filesystem path, not the `AiWorktree` instance itself — that class is git-integration's internal implementation, never serialized. */
  worktreePath: string | null;
  taskTokenMetrics: TaskTokenMetrics | null;
  errorMessage: string | null;
}

export function toTaskDto(task: Task): TaskDto {
  return {
    id: task.id,
    projectId: task.projectId,
    repositoryId: task.repositoryId,
    description: task.description,
    state: task.state,
    branchName: task.branchName,
    retryCount: task.retryCount,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

export function toWorkflowExecutionDto(execution: WorkflowExecution): WorkflowExecutionDto {
  return {
    id: execution.id,
    taskId: execution.taskId,
    status: execution.status,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt
  };
}

// --- Execution observability DTOs (Phase 14) ---
// A read-only projection of ExecutionReadModel's ExecutionDetails, built
// exclusively from the fields ExecutionDetails already exposes — nothing is
// recomputed or re-derived here. `providerReportedUsage` (present on the
// application-layer LLMRequestDetails) is deliberately NOT forwarded: it is
// an untyped, provider-defined bag that has never been reviewed for public
// exposure, so per this phase's security guidance it stays internal only.

export interface TokenUsageDto {
  input: number | null;
  output: number | null;
  cacheCreation: number | null;
  cacheRead: number | null;
  total: number | null;
}

export interface CostDto {
  estimated: number | null;
  calculated: number | null;
  currency: string | null;
}

export interface AgentExecutionDto {
  id: string;
  agentRole: string;
  status: string;
  retryNumber: number;
  startedAt: string;
  completedAt: string | null;
  llmRequestIds: readonly string[];
  outputArtifact: { kind: string; data: Record<string, unknown> } | null;
  /** Non-null exactly when status is 'FAILED' — the real reason, for display. */
  errorMessage: string | null;
}

export interface LLMRequestDto {
  id: string;
  agentExecutionId: string;
  provider: string;
  model: string;
  purpose: string;
  startedAt: string;
  completedAt: string | null;
  usage: TokenUsageDto;
  cost: CostDto;
}

export interface ContextObservabilityDto {
  filesScanned: number;
  filesSelected: number;
  relevanceScores: readonly { filePath: string; score: number }[];
  estimatedFullRepositoryTokens: number;
  estimatedSelectedContextTokens: number;
  estimatedContextAvoidedTokens: number;
}

export interface RetryObservabilityDto {
  taskRetryCount: number;
  agentExecutionCount: number;
  llmRequestCount: number;
  additionalTokens: TokenUsageDto;
  additionalCalculatedCost: number | null;
}

// --- Human review DTOs (Phase 16) ---

export interface ReviewDto {
  id: string;
  decision: string;
  comment: string | null;
  decidedAt: string;
}

export interface ReviewExecutionResponseBody {
  task: TaskDto;
  workflowExecution: WorkflowExecutionDto;
  review: ReviewDto;
}

/** Accepts both the read-model's `ReviewSummary` and the domain's `HumanReviewDecision` — both are structural supersets of what a ReviewDto needs. */
function toReviewDto(review: { id: string; decision: string; comment: string | null; decidedAt: string }): ReviewDto {
  return { id: review.id, decision: review.decision, comment: review.comment, decidedAt: review.decidedAt };
}

export function toReviewExecutionResponseDto(result: HumanReviewResult): ReviewExecutionResponseBody {
  return {
    task: toTaskDto(result.task),
    workflowExecution: toWorkflowExecutionDto(result.workflowExecution),
    review: toReviewDto(result.review)
  };
}

export interface ExecutionDetailsResponseBody {
  execution: WorkflowExecutionDto;
  task: {
    id: string;
    description: string;
    status: string;
    retryCount: number;
    createdAt: string;
    updatedAt: string;
  };
  agents: readonly AgentExecutionDto[];
  llmRequests: readonly LLMRequestDto[];
  context: ContextObservabilityDto | null;
  tokens: TokenUsageDto;
  cost: CostDto;
  retries: RetryObservabilityDto;
  /** Null until a human has approved/rejected this execution. Phase 16. */
  review: ReviewDto | null;
}

function toTokenUsageDto(usage: TokenUsage): TokenUsageDto {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheCreation: usage.cacheCreationTokens,
    cacheRead: usage.cacheReadTokens,
    total: usage.totalTokens
  };
}

export function toExecutionDetailsDto(details: ExecutionDetails): ExecutionDetailsResponseBody {
  return {
    execution: toWorkflowExecutionDto(details.execution),
    task: {
      id: details.task.id,
      description: details.task.description,
      status: details.task.status,
      retryCount: details.task.retryCount,
      createdAt: details.task.createdAt,
      updatedAt: details.task.updatedAt
    },
    agents: details.agents.map((agent) => ({
      id: agent.id,
      agentRole: agent.agentRole,
      status: agent.status,
      retryNumber: agent.retryNumber,
      startedAt: agent.startedAt,
      completedAt: agent.completedAt,
      llmRequestIds: agent.llmRequestIds,
      outputArtifact: agent.outputArtifact,
      errorMessage: agent.errorMessage
    })),
    llmRequests: details.llmRequests.map((request) => ({
      id: request.id,
      agentExecutionId: request.agentExecutionId,
      provider: request.provider,
      model: request.model,
      purpose: request.purpose,
      startedAt: request.startedAt,
      completedAt: request.completedAt,
      usage: toTokenUsageDto(request.normalizedUsage),
      cost: { estimated: request.estimatedCost, calculated: request.calculatedCost, currency: request.currency }
    })),
    context:
      details.context === null
        ? null
        : {
            filesScanned: details.context.filesScanned,
            filesSelected: details.context.filesSelected,
            relevanceScores: details.context.relevanceScores,
            estimatedFullRepositoryTokens: details.context.estimatedFullRepositoryTokens,
            estimatedSelectedContextTokens: details.context.estimatedSelectedContextTokens,
            estimatedContextAvoidedTokens: details.context.estimatedContextAvoidedTokens
          },
    tokens: toTokenUsageDto(details.tokens.actualUsage),
    cost: { estimated: details.cost.estimated, calculated: details.cost.calculated, currency: details.cost.currency },
    retries: {
      taskRetryCount: details.retries.taskRetryCount,
      agentExecutionCount: details.retries.agentExecutionCount,
      llmRequestCount: details.retries.llmRequestCount,
      additionalTokens: toTokenUsageDto(details.retries.overhead.additionalTokens),
      additionalCalculatedCost: details.retries.overhead.additionalCalculatedCost
    },
    review: details.review === null ? null : toReviewDto(details.review)
  };
}

// --- Execution diff DTOs (Phase 17) ---
// A direct, safe projection of ExecutionDiff — every path here is already
// repository-relative (never an absolute filesystem path) and every binary
// file's `patch` is already null, exactly as `@aet/orchestrator`/
// `@aet/git-integration` produced it. This layer adds no path handling,
// no diff parsing, and no filesystem access of its own.

export interface DiffFileDto {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  patch: string | null;
}

export interface ExecutionDiffResponseBody {
  executionId: string;
  files: readonly DiffFileDto[];
  additions: number;
  deletions: number;
  truncated: boolean;
}

export function toExecutionDiffDto(diff: ExecutionDiff): ExecutionDiffResponseBody {
  return {
    executionId: diff.executionId,
    files: diff.files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      binary: file.binary,
      patch: file.patch
    })),
    additions: diff.additions,
    deletions: diff.deletions,
    truncated: diff.truncated
  };
}
