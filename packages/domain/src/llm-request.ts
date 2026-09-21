import type { AgentExecutionId, LLMRequestId, TaskId } from './ids.js';
import type { TokenCost, TokenUsage } from './tokens.js';

export type LLMRequestPurpose =
  | 'PLAN'
  | 'IMPLEMENTATION'
  | 'TEST_INTERPRETATION'
  | 'CODE_REVIEW'
  | 'CONTEXT_EXPANSION_EVALUATION';

/**
 * One call to a provider. Deliberately provider-agnostic: `provider` and
 * `providerModel` are plain strings and `providerReportedUsage` is an
 * untyped bag, so this type never has to import a provider SDK.
 */
export interface LLMRequest {
  id: LLMRequestId;
  taskId: TaskId;
  agentExecutionId: AgentExecutionId;
  provider: string;
  providerModel: string;
  purpose: LLMRequestPurpose;
  startedAt: string;
  completedAt: string | null;
  normalizedUsage: TokenUsage;
  /** Raw usage block exactly as the provider returned it, or null before completion / if none was returned. Never fabricated. */
  providerReportedUsage: Record<string, unknown> | null;
  cost: TokenCost | null;
}
