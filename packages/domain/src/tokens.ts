import type { TaskId } from './ids.js';

/**
 * Normalized usage for a single LLM call. Any field a provider doesn't
 * expose must be `null` — never backfilled with a guess. See TOKEN_ECONOMY.md.
 */
export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  /** inputTokens + outputTokens when both are known, else null. */
  totalTokens: number | null;
}

export function sumTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const add = (x: number | null, y: number | null): number | null =>
    x === null && y === null ? null : (x ?? 0) + (y ?? 0);
  const inputTokens = add(a.inputTokens, b.inputTokens);
  const outputTokens = add(a.outputTokens, b.outputTokens);
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens: add(a.cacheCreationTokens, b.cacheCreationTokens),
    cacheReadTokens: add(a.cacheReadTokens, b.cacheReadTokens),
    totalTokens: inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0)
  };
}

export const ZERO_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0
};

/**
 * Total tokens derived directly from raw input/output counts — a standalone
 * unit for constructing a TokenUsage from a provider response, independent
 * of any value already stored in a TokenUsage.totalTokens field.
 */
export function calculateTotalTokens(inputTokens: number | null, outputTokens: number | null): number | null {
  if (inputTokens === null && outputTokens === null) return null;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
}

/**
 * (actual - estimated) / estimated, per TOKEN_ECONOMY.md's "estimate
 * variance" metric. Null when either side is unavailable, or the estimate
 * was zero (the ratio would be meaningless/undefined).
 */
export function estimateVariance(estimated: TokenUsage, actual: TokenUsage): number | null {
  const estimatedTotal = estimated.totalTokens;
  const actualTotal = actual.totalTokens;
  if (estimatedTotal === null || estimatedTotal === 0 || actualTotal === null) return null;
  return (actualTotal - estimatedTotal) / estimatedTotal;
}

export type Currency = 'USD';

export interface ModelPricing {
  provider: string;
  model: string;
  /** USD per 1,000,000 input tokens (non-cached). */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
  /** USD per 1,000,000 tokens written to cache, if the provider supports caching. */
  cacheWritePerMillion: number | null;
  /** USD per 1,000,000 tokens read from cache, if the provider supports caching. */
  cacheReadPerMillion: number | null;
  /** Identifies this pricing snapshot; persisted on every TokenCost calculated from it. */
  version: string;
  currency: Currency;
}

/**
 * calculatedCost = provider-reported token usage x our own versioned
 * pricing config — never a provider-billed figure (no provider API returns
 * one). Null if input/output tokens aren't known; missing cache counts are
 * treated as "no cache usage" (zero contribution), not as "cost unknown."
 */
export function calculateCost(usage: TokenUsage, pricing: ModelPricing): number | null {
  if (usage.inputTokens === null || usage.outputTokens === null) return null;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheWriteCost =
    usage.cacheCreationTokens !== null && pricing.cacheWritePerMillion !== null
      ? (usage.cacheCreationTokens / 1_000_000) * pricing.cacheWritePerMillion
      : 0;
  const cacheReadCost =
    usage.cacheReadTokens !== null && pricing.cacheReadPerMillion !== null
      ? (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion
      : 0;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

export interface TokenCost {
  estimatedCost: number | null;
  /** Never "actualCost" — no provider returns a billed dollar figure. See TOKEN_ECONOMY.md. */
  calculatedCost: number | null;
  /** ModelPricing.version used to produce calculatedCost, so a later pricing update never rewrites the meaning of a historical figure. */
  pricingVersion: string | null;
  currency: Currency;
}

/**
 * Per-task ceiling. `estimatedUsage`/`actualUsage` are running totals the
 * orchestrator updates as stages execute — see TOKEN_ECONOMY.md for how the
 * budget check gates execution.
 */
export interface TokenBudget {
  taskId: TaskId;
  /** Configured ceiling in tokens. Null means "no limit set" (still tracked, never enforced). */
  maxTokens: number | null;
  /** Optional configured cost ceiling in the given currency. */
  maxCost: number | null;
  currency: Currency;
  estimatedUsage: TokenUsage;
  actualUsage: TokenUsage;
  estimatedCost: number | null;
  /** Never "actualCost" — see TokenCost. */
  calculatedCost: number | null;
}

export function budgetUtilization(budget: TokenBudget): number | null {
  if (budget.maxTokens === null || budget.maxTokens === 0) return null;
  const used = budget.actualUsage.totalTokens ?? budget.estimatedUsage.totalTokens;
  if (used === null) return null;
  return used / budget.maxTokens;
}
