import { calculateCost, type TokenUsage } from '@aet/domain';
import { NoEligibleModelError } from './errors.js';
import type {
  ModelDescriptor,
  ModelSelectionRequest,
  ModelSelectionResult,
  RejectedCandidate,
  RejectionReason,
  SelectionReason
} from './types.js';

function usageFor(request: ModelSelectionRequest): TokenUsage {
  const outputTokens = request.expectedOutputTokens ?? 0;
  return {
    inputTokens: request.estimatedInputTokens,
    outputTokens,
    cacheCreationTokens: null,
    cacheReadTokens: null,
    totalTokens: request.estimatedInputTokens + outputTokens
  };
}

/**
 * Cost is computed here via @aet/domain's own `calculateCost` — never
 * reimplemented. Null when the candidate has no pricing attached; that is
 * never treated as a rejection on its own (see evaluateCandidate).
 */
function estimatedCostFor(descriptor: ModelDescriptor, request: ModelSelectionRequest): number | null {
  if (descriptor.pricing === null) return null;
  return calculateCost(usageFor(request), descriptor.pricing);
}

interface ValidCandidate {
  descriptor: ModelDescriptor;
  estimatedCost: number | null;
  matchedPreferredTier: boolean;
}

/**
 * Hard elimination rules, evaluated independently (a candidate can fail
 * more than one and every reason it fails is recorded — not just the
 * first). Cost/budget checks only apply "when the necessary information
 * exists" per the spec: a candidate is never rejected for a constraint it
 * doesn't have enough data to be checked against.
 */
function evaluateCandidate(descriptor: ModelDescriptor, request: ModelSelectionRequest): RejectedCandidate | ValidCandidate {
  const reasons: RejectionReason[] = [];

  if (!descriptor.available) {
    reasons.push('unavailable');
  }
  if (request.requiredProvider !== undefined && descriptor.provider !== request.requiredProvider) {
    reasons.push('provider_mismatch');
  }
  const missingCapability = request.requiredCapabilities.some((capability) => !descriptor.capabilities.includes(capability));
  if (missingCapability) {
    reasons.push('capability_unavailable');
  }

  const totalTokensNeeded = request.estimatedInputTokens + (request.expectedOutputTokens ?? 0);
  const exceedsContextLimit = request.estimatedInputTokens > descriptor.contextLimit;
  const exceedsOutputLimit = descriptor.outputLimit !== null && (request.expectedOutputTokens ?? 0) > descriptor.outputLimit;
  if (exceedsContextLimit || exceedsOutputLimit) {
    reasons.push('context_limit_exceeded');
  }

  if (request.tokenBudgetRemaining !== undefined && request.tokenBudgetRemaining !== null) {
    if (totalTokensNeeded > request.tokenBudgetRemaining) {
      reasons.push('budget_exceeds_remaining');
    }
  }

  const estimatedCost = estimatedCostFor(descriptor, request);
  if (request.maxEstimatedCost !== undefined && request.maxEstimatedCost !== null && estimatedCost !== null) {
    if (estimatedCost > request.maxEstimatedCost) {
      reasons.push('cost_exceeds_constraint');
    }
  }

  if (reasons.length > 0) {
    return { provider: descriptor.provider, model: descriptor.model, reasons };
  }

  return {
    descriptor,
    estimatedCost,
    matchedPreferredTier: request.preferredTier !== undefined && descriptor.tier === request.preferredTier
  };
}

function isRejected(candidate: RejectedCandidate | ValidCandidate): candidate is RejectedCandidate {
  return 'reasons' in candidate;
}

function candidateKey(descriptor: ModelDescriptor): string {
  return `${descriptor.provider}/${descriptor.model}`;
}

/**
 * Deterministic ranking among already-valid candidates: preferred tier
 * first, then lower estimated cost, then alphabetical provider/model as
 * the final tie-break — same inputs always produce the same order. No
 * scoring formula, no weights, nothing resembling an efficiency score.
 */
function rankValidCandidates(candidates: readonly ValidCandidate[]): readonly ValidCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.matchedPreferredTier !== b.matchedPreferredTier) {
      return a.matchedPreferredTier ? -1 : 1;
    }
    if (a.estimatedCost !== null && b.estimatedCost !== null && a.estimatedCost !== b.estimatedCost) {
      return a.estimatedCost - b.estimatedCost;
    }
    const aKey = candidateKey(a.descriptor);
    const bKey = candidateKey(b.descriptor);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

export function selectModel(catalog: readonly ModelDescriptor[], request: ModelSelectionRequest): ModelSelectionResult {
  const rejected: RejectedCandidate[] = [];
  const valid: ValidCandidate[] = [];

  for (const descriptor of catalog) {
    const evaluated = evaluateCandidate(descriptor, request);
    if (isRejected(evaluated)) {
      rejected.push(evaluated);
    } else {
      valid.push(evaluated);
    }
  }

  if (valid.length === 0) {
    throw new NoEligibleModelError(rejected);
  }

  const ranked = rankValidCandidates(valid);
  const winner = ranked[0];
  if (!winner) {
    throw new NoEligibleModelError(rejected); // unreachable: ranked has the same length as valid, already checked non-empty
  }

  const reason: SelectionReason = {
    matchedPreferredTier: winner.matchedPreferredTier,
    satisfiedCapabilities: request.requiredCapabilities,
    estimatedCost: winner.estimatedCost
  };

  return {
    selected: winner.descriptor,
    fallbacks: ranked.slice(1).map((candidate) => candidate.descriptor),
    rejectedCandidates: rejected,
    reason
  };
}
