import { estimateVariance, type TokenUsage } from '@aet/domain';

/**
 * Compares estimated vs. actual usage for one execution (or aggregated
 * across a task) — the raw material for judging whether the heuristic
 * estimator is any good. `variance` is domain's own
 * `(actual - estimated) / estimated`; this package never recomputes it.
 */
export interface EstimateVarianceReport {
  estimated: TokenUsage;
  actual: TokenUsage;
  variance: number | null;
}

export function buildEstimateVarianceReport(estimated: TokenUsage, actual: TokenUsage): EstimateVarianceReport {
  return { estimated, actual, variance: estimateVariance(estimated, actual) };
}
