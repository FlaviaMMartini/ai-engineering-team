import { sumTokenUsage, ZERO_TOKEN_USAGE, type TokenUsage } from '@aet/domain';

/** One retry's worth of usage/cost — typically taken from a single retry `AgentExecution`'s `LLMRequest`(s). */
export interface RetryUsageEntry {
  usage: TokenUsage;
  calculatedCost: number | null;
}

/**
 * Answers "how many tokens/how much cost did retries add" as an explicit,
 * separate number — never folded invisibly into the primary-path total.
 * No composite score here, just the raw count/sum, per TOKEN_ECONOMY.md's
 * "retries added ~12k tokens" signature message.
 */
export interface RetryOverhead {
  retryCount: number;
  additionalTokens: TokenUsage;
  /** Null only when every entry's calculatedCost is null (no pricing was available for any retry); otherwise the sum, treating null entries as 0. */
  additionalCalculatedCost: number | null;
}

export function summarizeRetryOverhead(retryEntries: readonly RetryUsageEntry[]): RetryOverhead {
  const additionalTokens = retryEntries.reduce((sum, entry) => sumTokenUsage(sum, entry.usage), ZERO_TOKEN_USAGE);

  const hasAnyKnownCost = retryEntries.some((entry) => entry.calculatedCost !== null);
  const additionalCalculatedCost = hasAnyKnownCost
    ? retryEntries.reduce((sum, entry) => sum + (entry.calculatedCost ?? 0), 0)
    : null;

  return { retryCount: retryEntries.length, additionalTokens, additionalCalculatedCost };
}
