import { describe, expect, it } from 'vitest';
import { estimatedContextAvoided, isValidContextExpansionRequest, type ContextExpansionRequest, type ContextMetric } from './context.js';

function makeMetric(overrides: Partial<ContextMetric> = {}): ContextMetric {
  return {
    filesScanned: 340,
    filesSelected: 12,
    relevanceScores: [],
    estimatedFullRepositoryTokens: 500_000,
    estimatedSelectedContextTokens: 45_000,
    ...overrides
  };
}

describe('estimatedContextAvoided', () => {
  it('is the direct subtraction of selected from full-repository estimated tokens', () => {
    expect(estimatedContextAvoided(makeMetric())).toBe(455_000);
  });

  it('does not depend on filesScanned/filesSelected counts at all', () => {
    const metric = makeMetric({ filesScanned: 1, filesSelected: 1 });
    expect(estimatedContextAvoided(metric)).toBe(455_000);
  });

  it('is zero when the full repository estimate equals the selected estimate', () => {
    const metric = makeMetric({ estimatedFullRepositoryTokens: 10_000, estimatedSelectedContextTokens: 10_000 });
    expect(estimatedContextAvoided(metric)).toBe(0);
  });
});

function makeRequest(overrides: Partial<ContextExpansionRequest> = {}): ContextExpansionRequest {
  return {
    id: 'expansion-1',
    requestingAgentExecutionId: 'agent-exec-1',
    reason: 'Need the shared UserSession type to extend the auth middleware.',
    filesRequested: ['src/types/session.ts'],
    filesApproved: ['src/types/session.ts'],
    estimatedAdditionalTokens: 800,
    budgetImpact: { remainingBudgetTokensBefore: 5000, remainingBudgetTokensAfter: 4200 },
    decision: 'APPROVED',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('isValidContextExpansionRequest', () => {
  it('accepts a fully approved request', () => {
    expect(isValidContextExpansionRequest(makeRequest())).toBe(true);
  });

  it('accepts a denied request with no approved files', () => {
    const request = makeRequest({ decision: 'DENIED', filesApproved: [] });
    expect(isValidContextExpansionRequest(request)).toBe(true);
  });

  it('accepts a partial approval that is a strict, non-empty subset', () => {
    const request = makeRequest({
      filesRequested: ['a.ts', 'b.ts'],
      filesApproved: ['a.ts'],
      decision: 'PARTIAL'
    });
    expect(isValidContextExpansionRequest(request)).toBe(true);
  });

  it('rejects a request with no files requested', () => {
    const request = makeRequest({ filesRequested: [], filesApproved: [], decision: 'DENIED' });
    expect(isValidContextExpansionRequest(request)).toBe(false);
  });

  it('rejects approved files that were never requested', () => {
    const request = makeRequest({ filesRequested: ['a.ts'], filesApproved: ['a.ts', 'b.ts'], decision: 'APPROVED' });
    expect(isValidContextExpansionRequest(request)).toBe(false);
  });

  it('rejects an APPROVED decision that only approved a subset', () => {
    const request = makeRequest({
      filesRequested: ['a.ts', 'b.ts'],
      filesApproved: ['a.ts'],
      decision: 'APPROVED'
    });
    expect(isValidContextExpansionRequest(request)).toBe(false);
  });

  it('rejects a DENIED decision that still approved a file', () => {
    const request = makeRequest({ decision: 'DENIED', filesApproved: ['src/types/session.ts'] });
    expect(isValidContextExpansionRequest(request)).toBe(false);
  });

  it('rejects a PARTIAL decision that approved everything requested', () => {
    const request = makeRequest({
      filesRequested: ['a.ts'],
      filesApproved: ['a.ts'],
      decision: 'PARTIAL'
    });
    expect(isValidContextExpansionRequest(request)).toBe(false);
  });

  it('rejects a PARTIAL decision that approved nothing', () => {
    const request = makeRequest({
      filesRequested: ['a.ts', 'b.ts'],
      filesApproved: [],
      decision: 'PARTIAL'
    });
    expect(isValidContextExpansionRequest(request)).toBe(false);
  });
});
