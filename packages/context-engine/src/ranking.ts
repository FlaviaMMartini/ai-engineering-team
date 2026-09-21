import type { ContextSelectionReason, DiscoveredFile } from './types.js';

export interface ScoredFile {
  file: DiscoveredFile;
  score: number;
  reasons: readonly ContextSelectionReason[];
}

/**
 * Score descending, then normalized relative path ascending. The path
 * tie-break is mandatory: identical repository state + identical task must
 * always produce identical ranking, never dependent on filesystem
 * enumeration order (which discovery already sorted away, but scoring can
 * still produce ties that need a deterministic resolution).
 */
export function rankFiles(scoredFiles: readonly ScoredFile[]): readonly ScoredFile[] {
  return [...scoredFiles].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.file.relativePath < b.file.relativePath ? -1 : a.file.relativePath > b.file.relativePath ? 1 : 0;
  });
}
