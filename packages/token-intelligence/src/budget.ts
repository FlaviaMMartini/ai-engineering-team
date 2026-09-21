import { budgetUtilization, sumTokenUsage, type TokenBudget, type TokenUsage } from '@aet/domain';

export interface BudgetStatus {
  /** From @aet/domain's budgetUtilization — null when no ceiling is configured or no usage is known yet. */
  utilization: number | null;
  /** maxTokens - (actual ?? estimated) totalTokens. Null under the same conditions as utilization. */
  remainingTokens: number | null;
  isOverBudget: boolean;
}

/** Reports status only — this package never refuses or halts execution itself; that policy call belongs to the Orchestrator. */
export function evaluateBudgetStatus(budget: TokenBudget): BudgetStatus {
  const utilization = budgetUtilization(budget);
  const used = budget.actualUsage.totalTokens ?? budget.estimatedUsage.totalTokens;
  const remainingTokens = budget.maxTokens === null || used === null ? null : budget.maxTokens - used;
  const isOverBudget = remainingTokens !== null && remainingTokens < 0;

  return { utilization, remainingTokens, isOverBudget };
}

/** The only mutation path for "usage happened" — folds `additional` into the budget's actualUsage running total via domain's sumTokenUsage. */
export function applyUsageToBudget(budget: TokenBudget, additional: TokenUsage): TokenBudget {
  return { ...budget, actualUsage: sumTokenUsage(budget.actualUsage, additional) };
}
