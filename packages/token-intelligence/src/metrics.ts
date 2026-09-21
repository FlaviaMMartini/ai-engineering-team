import type { TaskId, TokenBudget, TokenCost } from '@aet/domain';
import { evaluateBudgetStatus, type BudgetStatus } from './budget.js';
import type { ContextExpansionTokenImpact } from './context-expansion.js';
import type { RetryOverhead } from './retry-overhead.js';
import { buildEstimateVarianceReport, type EstimateVarianceReport } from './variance.js';

/**
 * The structured shape a future API/UI reads directly — every field here
 * traces back to a real computed value from this package or @aet/domain.
 * No natural-language narration is generated; a future UI layer decides
 * how to phrase these numbers, this package only guarantees they're real.
 */
export interface TaskTokenMetrics {
  taskId: TaskId;
  estimatedUsage: TokenBudget['estimatedUsage'];
  actualUsage: TokenBudget['actualUsage'];
  /** From the Context Engine's ContextMetric (estimatedContextAvoided) — null if no context pass has run yet. */
  estimatedContextAvoided: number | null;
  budget: BudgetStatus;
  cost: TokenCost;
  variance: EstimateVarianceReport;
  retryOverhead: RetryOverhead;
  contextExpansions: readonly ContextExpansionTokenImpact[];
  provider: string | null;
  model: string | null;
}

export interface BuildTaskTokenMetricsInput {
  taskId: TaskId;
  budget: TokenBudget;
  cost: TokenCost;
  estimatedContextAvoided: number | null;
  retryOverhead: RetryOverhead;
  contextExpansions: readonly ContextExpansionTokenImpact[];
  provider: string | null;
  model: string | null;
}

export function buildTaskTokenMetrics(input: BuildTaskTokenMetricsInput): TaskTokenMetrics {
  return {
    taskId: input.taskId,
    estimatedUsage: input.budget.estimatedUsage,
    actualUsage: input.budget.actualUsage,
    estimatedContextAvoided: input.estimatedContextAvoided,
    budget: evaluateBudgetStatus(input.budget),
    cost: input.cost,
    variance: buildEstimateVarianceReport(input.budget.estimatedUsage, input.budget.actualUsage),
    retryOverhead: input.retryOverhead,
    contextExpansions: input.contextExpansions,
    provider: input.provider,
    model: input.model
  };
}
