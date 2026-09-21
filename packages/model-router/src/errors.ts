import type { RejectedCandidate } from './types.js';

export class ModelRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRouterError';
  }
}

/** Thrown when every catalog entry was eliminated — carries the full rejection trail so the caller can see exactly why. */
export class NoEligibleModelError extends ModelRouterError {
  readonly rejectedCandidates: readonly RejectedCandidate[];

  constructor(rejectedCandidates: readonly RejectedCandidate[]) {
    super(`No eligible model found among ${rejectedCandidates.length} candidate(s)`);
    this.name = 'NoEligibleModelError';
    this.rejectedCandidates = rejectedCandidates;
  }
}
