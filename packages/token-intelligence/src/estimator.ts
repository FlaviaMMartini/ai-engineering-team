/**
 * Same function shape as @aet/context-engine's own `TokenEstimator`
 * (`(content: string) => number`) — deliberately not imported from there.
 * Neither package depends on the other (see ARCHITECTURE.md's dependency
 * graph: both are leaves off `domain`); the Orchestrator is what will wire
 * a token-intelligence estimator into `createContextEngine({ tokenEstimator })`.
 * TypeScript's structural typing makes the two interchangeable without
 * either package importing the other.
 */
export type TokenEstimator = (content: string) => number;

export type TokenEstimationMethod = 'heuristic-character-count';

/**
 * Default heuristic: ~4 characters per token, the same rough ratio widely
 * used for English text across GPT/Claude-style tokenizers. This is
 * deliberately conservative and cheap — never a network call, never a
 * model call. It is an ESTIMATE, not a provider's real tokenization:
 * nothing in this package should ever present its output as exact.
 * `estimateVariance` (see variance.ts, wrapping @aet/domain's
 * estimateVariance) exists specifically to measure how far off it runs
 * once real provider usage is available.
 */
export const DEFAULT_CHARACTERS_PER_TOKEN = 4;

export interface HeuristicTokenEstimatorOptions {
  charactersPerToken?: number;
}

/**
 * Factory, not a singleton function — so a future
 * `createAnthropicTokenizerEstimator()` / `createOpenAiTokenizerEstimator()`
 * can implement the exact same `TokenEstimator` shape and be swapped in
 * without any caller changing.
 */
export function createHeuristicTokenEstimator(options: HeuristicTokenEstimatorOptions = {}): TokenEstimator {
  const charactersPerToken = options.charactersPerToken ?? DEFAULT_CHARACTERS_PER_TOKEN;

  return (content: string): number => {
    if (content.length === 0) return 0;
    return Math.ceil(content.length / charactersPerToken);
  };
}

/** Sums an estimator's output across many pieces of content (e.g. every file selected for a ContextPack). */
export function estimateManyTokens(estimator: TokenEstimator, contents: readonly string[]): number {
  return contents.reduce((total, content) => total + estimator(content), 0);
}
