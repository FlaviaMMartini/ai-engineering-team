import type { AgentExecutionId, ContextExpansionRequestId, ContextPackId, TaskId } from './ids.js';

export interface RelevanceScore {
  filePath: string;
  score: number;
}

export interface ContextMetric {
  filesScanned: number;
  filesSelected: number;
  relevanceScores: readonly RelevanceScore[];
  estimatedFullRepositoryTokens: number;
  estimatedSelectedContextTokens: number;
}

/**
 * estimatedFullRepositoryTokens - estimatedSelectedContextTokens. This is
 * the whole domain meaning of "context avoided" — never
 * averageTokensPerFile x filesScanned, which breaks the moment file sizes
 * are non-uniform. See TOKEN_ECONOMY.md.
 */
export function estimatedContextAvoided(metric: ContextMetric): number {
  return metric.estimatedFullRepositoryTokens - metric.estimatedSelectedContextTokens;
}

export interface ContextFileExcerpt {
  filePath: string;
  content: string;
}

export interface ContextPack {
  id: ContextPackId;
  taskId: TaskId;
  /** Null until the AgentExecution it was built for has been created. */
  agentExecutionId: AgentExecutionId | null;
  files: readonly ContextFileExcerpt[];
  metric: ContextMetric;
  createdAt: string;
}

export type ContextExpansionDecision = 'APPROVED' | 'PARTIAL' | 'DENIED';

export interface ContextExpansionBudgetImpact {
  remainingBudgetTokensBefore: number | null;
  remainingBudgetTokensAfter: number | null;
}

/**
 * Raised by an agent (Developer, in the MVP pipeline) when the files it was
 * given are insufficient. The Context Engine remains the sole authority
 * over which files are relevant — this is a request, not a self-service
 * grant. See AGENT_DESIGN.md's context expansion flow.
 */
export interface ContextExpansionRequest {
  id: ContextExpansionRequestId;
  requestingAgentExecutionId: AgentExecutionId;
  reason: string;
  filesRequested: readonly string[];
  filesApproved: readonly string[];
  estimatedAdditionalTokens: number | null;
  budgetImpact: ContextExpansionBudgetImpact;
  decision: ContextExpansionDecision;
  createdAt: string;
}

/**
 * Structural validity only (not a policy check): filesApproved must be a
 * subset of filesRequested, at least one file must have been requested, and
 * filesApproved must be consistent with the recorded decision.
 */
export function isValidContextExpansionRequest(request: ContextExpansionRequest): boolean {
  if (request.filesRequested.length === 0) return false;

  const requested = new Set(request.filesRequested);
  const approvedIsSubsetOfRequested = request.filesApproved.every((file) => requested.has(file));
  if (!approvedIsSubsetOfRequested) return false;

  switch (request.decision) {
    case 'DENIED':
      return request.filesApproved.length === 0;
    case 'APPROVED':
      return request.filesApproved.length === request.filesRequested.length;
    case 'PARTIAL':
      return request.filesApproved.length > 0 && request.filesApproved.length < request.filesRequested.length;
  }
}
