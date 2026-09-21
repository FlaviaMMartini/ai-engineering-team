import type { ScoredFile } from './ranking.js';
import type { ContextCandidate, DiscoveredFile, TokenEstimator } from './types.js';

export interface SelectionResult {
  /** Every ranked candidate, selected or excluded, in ranked order. */
  candidates: readonly ContextCandidate[];
  selectedFiles: readonly DiscoveredFile[];
  totalSelectedTokens: number;
}

/**
 * Budget-aware selection over already-ranked candidates.
 *
 * Three gates, evaluated per candidate in rank order (never "first N"):
 *   1. binary files are never selectable — excluded as `ignored`.
 *   2. zero-relevance files (no signal at all) are never selected even if
 *      budget remains — excluded as `low_relevance`. Narrowing context is
 *      the point of this package; "select everything until the budget runs
 *      out" would defeat it.
 *   3. otherwise, the file competes for remaining budget: if its estimated
 *      tokens fit, it's selected and the budget shrinks; if not, it's
 *      excluded as `budget_exceeded` and evaluation CONTINUES to the next
 *      candidate (a small highly-relevant file later in rank order can
 *      still be selected after a large one was skipped).
 *
 * A single oversized file is excluded, never truncated and never allowed
 * to silently exceed the budget.
 */
export function selectFilesUnderBudget(
  rankedFiles: readonly ScoredFile[],
  maxContextTokens: number,
  tokenEstimator: TokenEstimator
): SelectionResult {
  let remainingBudget = Math.max(maxContextTokens, 0);
  let totalSelectedTokens = 0;

  const candidates: ContextCandidate[] = [];
  const selectedFiles: DiscoveredFile[] = [];

  for (const scored of rankedFiles) {
    const { file, score, reasons } = scored;

    if (file.isBinary || file.content === null) {
      candidates.push({ path: file.relativePath, score, estimatedTokens: 0, decision: 'excluded', reasons: ['ignored'] });
      continue;
    }

    const estimatedTokens = tokenEstimator(file.content);

    if (score === 0) {
      candidates.push({ path: file.relativePath, score, estimatedTokens, decision: 'excluded', reasons: ['low_relevance'] });
      continue;
    }

    if (estimatedTokens <= remainingBudget) {
      remainingBudget -= estimatedTokens;
      totalSelectedTokens += estimatedTokens;
      selectedFiles.push(file);
      candidates.push({ path: file.relativePath, score, estimatedTokens, decision: 'selected', reasons });
    } else {
      candidates.push({ path: file.relativePath, score, estimatedTokens, decision: 'excluded', reasons: ['budget_exceeded'] });
    }
  }

  return { candidates, selectedFiles, totalSelectedTokens };
}
