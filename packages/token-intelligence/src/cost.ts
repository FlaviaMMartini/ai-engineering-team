import { calculateCost, type TokenCost, type TokenUsage } from '@aet/domain';
import type { PricingTableEntry } from './pricing.js';

/**
 * Thin orchestration, not a reimplementation: the arithmetic is entirely
 * @aet/domain's `calculateCost`. This just shapes the result into a
 * `TokenCost` and records which pricing version produced it — never
 * "actualCost" or "billed cost", since no provider API returns one. See
 * TOKEN_ECONOMY.md.
 */
export function calculateTokenCost(usage: TokenUsage, pricing: PricingTableEntry, estimatedCost: number | null = null): TokenCost {
  return {
    estimatedCost,
    calculatedCost: calculateCost(usage, pricing),
    pricingVersion: pricing.version,
    currency: pricing.currency
  };
}
