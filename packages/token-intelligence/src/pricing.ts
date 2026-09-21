import type { ModelPricing } from '@aet/domain';

/**
 * `ModelPricing` (domain) already carries provider/model/prices/version/
 * currency. A pricing TABLE also needs to know which entry applies as of
 * what date, so this extends it with exactly that one field rather than
 * duplicating the other eight — the same pattern @aet/persistence used for
 * `ContextMetricRecord` wrapping domain's `ContextMetric`.
 */
export interface PricingTableEntry extends ModelPricing {
  /** ISO date/timestamp this entry becomes the applicable price for its provider+model. */
  effectiveDate: string;
}

export interface PricingTable {
  /** The entry with the latest effectiveDate that is not after `asOf`, for this provider+model. Null if none applies yet. */
  findCurrent(provider: string, model: string, asOf: string): PricingTableEntry | null;
  findByVersion(provider: string, model: string, version: string): PricingTableEntry | null;
  list(): readonly PricingTableEntry[];
}

/**
 * In-memory, injected pricing table — deliberately not seeded with any
 * real-world dollar figures here. Real prices are provider-specific
 * configuration that belongs with the Providers phase (or an external
 * config source), not hardcoded guesses in this package.
 */
export function createPricingTable(entries: readonly PricingTableEntry[]): PricingTable {
  const sorted = [...entries].sort((a, b) =>
    a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0
  );

  return {
    findCurrent(provider, model, asOf) {
      let candidate: PricingTableEntry | null = null;
      for (const entry of sorted) {
        if (entry.provider !== provider || entry.model !== model) continue;
        if (entry.effectiveDate > asOf) continue;
        candidate = entry; // ascending sort: the last qualifying entry is the most recent one
      }
      return candidate;
    },
    findByVersion(provider, model, version) {
      return sorted.find((entry) => entry.provider === provider && entry.model === model && entry.version === version) ?? null;
    },
    list() {
      return sorted;
    }
  };
}
