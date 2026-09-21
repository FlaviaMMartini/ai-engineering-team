import type { ContextExpansionBudgetImpact, ContextExpansionRequest } from '@aet/domain';

/**
 * Projects the token/cost-relevant subset of an existing
 * `ContextExpansionRequest` (domain) — never a second model. `reason`,
 * `filesRequested`, `filesApproved`, and `decision` all stay on the
 * domain record; this only adds what domain's record has no field for
 * (calculated cost of the approved addition).
 */
export interface ContextExpansionTokenImpact {
  requestId: string;
  estimatedAddedTokens: number | null;
  budgetImpact: ContextExpansionBudgetImpact;
  additionalCalculatedCost: number | null;
}

export function summarizeContextExpansionImpact(
  request: ContextExpansionRequest,
  additionalCalculatedCost: number | null = null
): ContextExpansionTokenImpact {
  return {
    requestId: request.id,
    estimatedAddedTokens: request.estimatedAdditionalTokens,
    budgetImpact: request.budgetImpact,
    additionalCalculatedCost
  };
}
