import { describe, expect, it } from 'vitest';
import {
  ZERO_TOKEN_USAGE,
  budgetUtilization,
  calculateCost,
  calculateTotalTokens,
  estimateVariance,
  sumTokenUsage,
  type ModelPricing,
  type TokenBudget,
  type TokenUsage
} from './tokens.js';

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return { ...ZERO_TOKEN_USAGE, ...overrides };
}

describe('sumTokenUsage', () => {
  it('adds two known usages field by field', () => {
    const a = usage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    const b = usage({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
    expect(sumTokenUsage(a, b)).toEqual(usage({ inputTokens: 120, outputTokens: 60, totalTokens: 180 }));
  });

  it('never fabricates a value when both sides are null', () => {
    const a = usage({ cacheReadTokens: null });
    const b = usage({ cacheReadTokens: null });
    expect(sumTokenUsage(a, b).cacheReadTokens).toBeNull();
  });

  it('treats a null side as zero when the other side is known', () => {
    const a = usage({ cacheReadTokens: null });
    const b = usage({ cacheReadTokens: 40 });
    expect(sumTokenUsage(a, b).cacheReadTokens).toBe(40);
  });
});

describe('calculateTotalTokens', () => {
  it('sums known input and output', () => {
    expect(calculateTotalTokens(100, 50)).toBe(150);
  });

  it('is null when both are null', () => {
    expect(calculateTotalTokens(null, null)).toBeNull();
  });

  it('treats one null side as zero when the other is known', () => {
    expect(calculateTotalTokens(100, null)).toBe(100);
    expect(calculateTotalTokens(null, 50)).toBe(50);
  });
});

describe('estimateVariance', () => {
  it('computes (actual - estimated) / estimated', () => {
    const estimated = usage({ totalTokens: 1000 });
    const actual = usage({ totalTokens: 1200 });
    expect(estimateVariance(estimated, actual)).toBeCloseTo(0.2);
  });

  it('is negative when actual usage came in under estimate', () => {
    const estimated = usage({ totalTokens: 1000 });
    const actual = usage({ totalTokens: 800 });
    expect(estimateVariance(estimated, actual)).toBeCloseTo(-0.2);
  });

  it('is null when the estimate is unavailable', () => {
    expect(estimateVariance(usage({ totalTokens: null }), usage({ totalTokens: 100 }))).toBeNull();
  });

  it('is null when actual usage is unavailable', () => {
    expect(estimateVariance(usage({ totalTokens: 100 }), usage({ totalTokens: null }))).toBeNull();
  });

  it('is null when the estimate is zero (division would be meaningless)', () => {
    expect(estimateVariance(usage({ totalTokens: 0 }), usage({ totalTokens: 100 }))).toBeNull();
  });
});

const PRICING: ModelPricing = {
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheWritePerMillion: 3.75,
  cacheReadPerMillion: 0.3,
  version: 'anthropic-2026-01',
  currency: 'USD'
};

describe('calculateCost', () => {
  it('calculates input + output cost with no cache activity', () => {
    const cost = calculateCost(usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), PRICING);
    expect(cost).toBeCloseTo(3 + 15);
  });

  it('includes cache write and cache read cost when reported', () => {
    const cost = calculateCost(
      usage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000
      }),
      PRICING
    );
    expect(cost).toBeCloseTo(3 + 15 + 3.75 + 0.3);
  });

  it('treats unreported cache tokens as zero cost, not unknown cost', () => {
    const cost = calculateCost(
      usage({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: null, cacheReadTokens: null }),
      PRICING
    );
    expect(cost).toBeCloseTo(3 + 15);
  });

  it('is null when input tokens are unknown', () => {
    expect(calculateCost(usage({ inputTokens: null, outputTokens: 100 }), PRICING)).toBeNull();
  });

  it('is null when output tokens are unknown', () => {
    expect(calculateCost(usage({ inputTokens: 100, outputTokens: null }), PRICING)).toBeNull();
  });
});

function makeBudget(overrides: Partial<TokenBudget> = {}): TokenBudget {
  return {
    taskId: 'task-1',
    maxTokens: 100_000,
    maxCost: null,
    currency: 'USD',
    estimatedUsage: ZERO_TOKEN_USAGE,
    actualUsage: ZERO_TOKEN_USAGE,
    estimatedCost: null,
    calculatedCost: null,
    ...overrides
  };
}

describe('budgetUtilization', () => {
  it('prefers actual usage over estimated usage once available', () => {
    const budget = makeBudget({
      maxTokens: 1000,
      estimatedUsage: usage({ totalTokens: 400 }),
      actualUsage: usage({ totalTokens: 250 })
    });
    expect(budgetUtilization(budget)).toBeCloseTo(0.25);
  });

  it('falls back to estimated usage before actual usage exists', () => {
    const budget = makeBudget({
      maxTokens: 1000,
      estimatedUsage: usage({ totalTokens: 400 }),
      actualUsage: usage({ totalTokens: null })
    });
    expect(budgetUtilization(budget)).toBeCloseTo(0.4);
  });

  it('is null when no budget ceiling is configured', () => {
    expect(budgetUtilization(makeBudget({ maxTokens: null }))).toBeNull();
  });

  it('is null when neither actual nor estimated usage is known', () => {
    const budget = makeBudget({
      maxTokens: 1000,
      estimatedUsage: usage({ totalTokens: null }),
      actualUsage: usage({ totalTokens: null })
    });
    expect(budgetUtilization(budget)).toBeNull();
  });
});
