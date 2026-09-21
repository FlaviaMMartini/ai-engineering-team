import type { ContextFileExcerpt, ContextMetric, ContextPack, RelevanceScore } from '@aet/domain';
import { DEFAULT_IGNORED_DIRECTORIES, discoverFiles } from './discovery.js';
import { extractTaskKeywords } from './keywords.js';
import { resolveRepositoryRoot } from './paths.js';
import { rankFiles, type ScoredFile } from './ranking.js';
import { buildRepositorySummary } from './repository-summary.js';
import { scoreAllCandidates } from './scoring.js';
import { selectFilesUnderBudget } from './selection.js';
import type { BuildContextInput, ContextBuildResult, ContextEngine, ContextEngineOptions } from './types.js';

/**
 * Total estimated tokens for the entire scanned repository (binary files
 * contribute 0 — they're never sent as LLM text regardless). This and the
 * selected-context total are the only two numbers `estimatedContextAvoided`
 * (see @aet/domain) ever subtracts.
 */
function estimateFullRepositoryTokens(
  files: readonly { content: string | null; isBinary: boolean }[],
  tokenEstimator: ContextEngineOptions['tokenEstimator']
): number {
  let total = 0;
  for (const file of files) {
    if (file.isBinary || file.content === null) continue;
    total += tokenEstimator(file.content);
  }
  return total;
}

export function createContextEngine(options: ContextEngineOptions): ContextEngine {
  const ignoredDirectories = options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES;

  function buildContext(input: BuildContextInput): ContextBuildResult {
    const repositoryRootReal = resolveRepositoryRoot(input.repositoryRoot);
    const files = discoverFiles(repositoryRootReal, ignoredDirectories);

    const keywords = extractTaskKeywords(input.taskDescription);
    const breakdownByPath = scoreAllCandidates(files, keywords);

    const scoredFiles: ScoredFile[] = files.map((file) => {
      const breakdown = breakdownByPath.get(file.relativePath);
      return { file, score: breakdown?.score ?? 0, reasons: breakdown?.reasons ?? [] };
    });

    const ranked = rankFiles(scoredFiles);
    const selection = selectFilesUnderBudget(ranked, input.maxContextTokens, options.tokenEstimator);

    const estimatedFullRepositoryTokens = estimateFullRepositoryTokens(files, options.tokenEstimator);
    // Clamped so estimatedContextAvoided (full - selected) can never go negative, even if the
    // injected estimator is non-additive across files (it's a black box this package doesn't control).
    const estimatedSelectedContextTokens = Math.min(selection.totalSelectedTokens, estimatedFullRepositoryTokens);

    const relevanceScores: readonly RelevanceScore[] = ranked.map((scored) => ({
      filePath: scored.file.relativePath,
      score: scored.score
    }));

    const metric: ContextMetric = {
      filesScanned: files.length,
      filesSelected: selection.selectedFiles.length,
      relevanceScores,
      estimatedFullRepositoryTokens,
      estimatedSelectedContextTokens
    };

    const selectedFileExcerpts: readonly ContextFileExcerpt[] = selection.selectedFiles.map((file) => ({
      filePath: file.relativePath,
      content: file.content ?? ''
    }));

    const contextPack: ContextPack = {
      id: input.contextPackId,
      taskId: input.taskId,
      agentExecutionId: input.agentExecutionId ?? null,
      files: selectedFileExcerpts,
      metric,
      createdAt: input.createdAt
    };

    const repositorySummary = buildRepositorySummary(repositoryRootReal, files);

    return { contextPack, candidates: selection.candidates, repositorySummary };
  }

  return { buildContext };
}
