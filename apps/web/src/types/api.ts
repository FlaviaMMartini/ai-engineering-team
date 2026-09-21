/**
 * Frontend transport types. These mirror the JSON shapes returned by
 * apps/api's HTTP layer (see apps/api/src/http/types.ts) — they are wire
 * contracts owned by this frontend, not a re-import of backend/domain
 * types. Kept in sync by hand; if the backend DTO shape changes, this file
 * changes with it.
 */

/** The known Task workflow states (see domain's TaskState). Kept as a plain string union here — the wire field itself is `string`, matching the backend DTO. */
export type TaskStatus = 'BACKLOG' | 'PLANNING' | 'READY' | 'IN_PROGRESS' | 'QA' | 'HUMAN_REVIEW' | 'DONE' | 'FAILED' | 'BLOCKED';

/** WorkflowExecution.status — a coarser, separate concept from TaskStatus. */
export type WorkflowExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

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
  /** The worktree's filesystem path, shown for context only — the UI never reads it from disk. */
  worktreePath: string | null;
  errorMessage: string | null;
}

/** The only two decisions a human can record — see backend's HumanReviewDecisionType. */
export type ReviewDecisionType = 'APPROVED' | 'REJECTED';

export interface ReviewDto {
  id: string;
  decision: string;
  comment: string | null;
  decidedAt: string;
}

export interface ReviewExecutionRequestBody {
  taskId: string;
  decision: ReviewDecisionType;
  comment?: string | null;
}

export interface ReviewExecutionResponseBody {
  task: TaskDto;
  workflowExecution: WorkflowExecutionDto;
  review: ReviewDto;
}

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
  /** Non-null exactly when status is 'FAILED' — the real reason it failed. */
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
  /** Null until a human has approved/rejected this execution. */
  review: ReviewDto | null;
}

/** Mirrors git-integration's WorktreeDiffFileStatus, via the backend's DiffFileDto. Kept as `string` here — the same convention as other backend status/state fields (see TaskDto.state). */
export interface DiffFileDto {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  /** Null for binary files, and null on every file when `truncated` is true. */
  patch: string | null;
}

export interface ExecutionDiffResponseBody {
  executionId: string;
  files: readonly DiffFileDto[];
  additions: number;
  deletions: number;
  truncated: boolean;
}

// --- Projects & BYOK provider credentials (Phase 19) ---
// The frontend only ever learns a provider's connection status
// (connected/not_configured/invalid) — it never receives, stores, or
// displays an API key after the connect form submits it.

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface CreateProjectRequestBody {
  name: string;
  description?: string | null;
}

export interface CreateProjectResponseBody {
  project: ProjectDto;
}

export interface ListProjectsResponseBody {
  projects: readonly ProjectDto[];
}

export interface ProviderConfigurationDto {
  provider: string;
  status: string;
}

export interface ListProviderConfigurationsResponseBody {
  providers: readonly ProviderConfigurationDto[];
}

/** Phase 21 (Kanban board): a project's tasks, for grouping into TaskStatus columns. */
export interface ListProjectTasksResponseBody {
  tasks: readonly TaskDto[];
}

// --- Repository selection (Phase 21) ---

export interface RepositoryDto {
  id: string;
  projectId: string;
  name: string;
  localPath: string;
  defaultBranch: string;
  createdAt: string;
}

export interface RegisterRepositoryRequestBody {
  name: string;
  path: string;
}

export interface ListRepositoriesResponseBody {
  repositories: readonly RepositoryDto[];
}

export interface ConnectProviderCredentialRequestBody {
  apiKey: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
