import type { ContextExpansionBudgetImpact, ContextExpansionDecision, TokenBudget } from '@aet/domain';
import type { ContextCandidate } from '@aet/context-engine';
import type { ContextExpansionProposal } from '@aet/agent-runtime';
import { evaluateBudgetStatus } from '@aet/token-intelligence';
import type { EvaluatedContextExpansion } from './types.js';

/**
 * The automatic decision policy AGENT_DESIGN.md describes: DENIED when
 * nothing requested was actually found (most commonly because the Developer
 * asked to "read" files that don't exist yet — those should just be
 * created, not granted), DENIED when granting everything found would blow
 * the budget (never silently overspend — see AGENT_DESIGN.md's Orchestrator
 * duties), APPROVED when every requested file was found and affordable, and
 * PARTIAL otherwise. No human decision is involved — this mirrors how the
 * initial `ContextPack` selection is itself automatic.
 */
function decideExpansion(filesFound: readonly string[], requestedCount: number, budgetImpact: ContextExpansionBudgetImpact): ContextExpansionDecision {
  if (filesFound.length === 0) return 'DENIED';
  if (budgetImpact.remainingBudgetTokensAfter !== null && budgetImpact.remainingBudgetTokensAfter < 0) return 'DENIED';
  return filesFound.length === requestedCount ? 'APPROVED' : 'PARTIAL';
}

/**
 * Evaluates a Developer's context-expansion proposal against Context
 * Engine's OWN already-computed candidate list from the original
 * `buildContext()` call — every scanned file (selected or not) already has
 * an estimated token count there, so no second Context Engine call is
 * needed. Token Intelligence's `evaluateBudgetStatus` supplies the budget
 * side. Produces a real, automatic decision (see `decideExpansion` above) —
 * the Orchestrator's main loop acts on it directly (see orchestrator.ts).
 */
export function evaluateContextExpansion(
  proposal: ContextExpansionProposal,
  candidates: readonly ContextCandidate[],
  budget: TokenBudget,
  /** The Architect's own plan.filesToCreate — see `filesAlreadyPlannedToCreate` on EvaluatedContextExpansion. */
  plannedFilesToCreate: readonly string[]
): EvaluatedContextExpansion {
  const candidatesByPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
  const plannedToCreate = new Set(plannedFilesToCreate);
  const filesAlreadyPlannedToCreate = proposal.filesRequested.filter((path) => plannedToCreate.has(path));

  const found = proposal.filesRequested
    .map((path) => candidatesByPath.get(path))
    .filter((candidate): candidate is ContextCandidate => candidate !== undefined);
  const filesFound = found.map((candidate) => candidate.path);
  const filesNotFound = proposal.filesRequested.filter((path) => !candidatesByPath.has(path));
  const estimatedAdditionalTokens = found.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0);

  const { remainingTokens } = evaluateBudgetStatus(budget);
  const budgetImpact: ContextExpansionBudgetImpact = {
    remainingBudgetTokensBefore: remainingTokens,
    remainingBudgetTokensAfter: remainingTokens === null ? null : remainingTokens - estimatedAdditionalTokens
  };

  const decision = decideExpansion(filesFound, proposal.filesRequested.length, budgetImpact);
  const filesApproved = decision === 'DENIED' ? [] : filesFound;

  return {
    proposal,
    filesFound,
    filesNotFound,
    filesApproved,
    filesAlreadyPlannedToCreate,
    decision,
    estimatedAdditionalTokens,
    budgetImpact
  };
}
