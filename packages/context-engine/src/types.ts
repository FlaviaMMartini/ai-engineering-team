import type { AgentExecutionId, ContextPack, ContextPackId, TaskId } from '@aet/domain';

/**
 * The ONLY source of token estimates this package ever uses. Context Engine
 * never implements its own heuristic and never imports token-intelligence —
 * see TOKEN_ECONOMY.md and ARCHITECTURE.md for why that boundary matters.
 */
export type TokenEstimator = (content: string) => number;

export type FileClassification = 'source' | 'test' | 'config' | 'metadata' | 'documentation' | 'unknown';

export interface DiscoveredFile {
  /** Normalized, forward-slash, relative to the repository root. */
  relativePath: string;
  /** Canonical (symlink-resolved) absolute path — safe to read directly. */
  absolutePath: string;
  sizeBytes: number;
  /** Null for files classified as binary — never sent through scoring or the token estimator. */
  content: string | null;
  isBinary: boolean;
  classification: FileClassification;
}

export type ContextSelectionReason =
  | 'filename_match'
  | 'path_match'
  | 'content_match'
  | 'file_role_match'
  | 'relationship_match'
  | 'budget_exceeded'
  | 'low_relevance'
  | 'ignored';

export type ContextCandidateDecision = 'selected' | 'excluded';

/**
 * Structured, per-file explainability record. Reasons are typed tags, not
 * natural-language text — a future UI translates them, this package doesn't.
 */
export interface ContextCandidate {
  path: string;
  score: number;
  estimatedTokens: number;
  decision: ContextCandidateDecision;
  reasons: readonly ContextSelectionReason[];
}

export interface RepositorySummary {
  totalFilesScanned: number;
  sourceFileCount: number;
  testFileCount: number;
  configFileCount: number;
  documentationFileCount: number;
  topLevelEntries: readonly string[];
  packageManager: 'npm' | 'yarn' | 'pnpm' | null;
  dependencies: readonly string[];
  devDependencies: readonly string[];
  hasTypeScriptConfig: boolean;
}

export interface ContextEngineOptions {
  tokenEstimator: TokenEstimator;
  ignoredDirectories?: readonly string[];
}

/**
 * The domain `ContextPack` needs an id, a taskId, and a createdAt stamp that
 * the prompt's original sketch didn't include. Per this package's own
 * determinism requirement (identical repo + identical task -> identical
 * output) these are caller-supplied rather than generated internally
 * (crypto.randomUUID()/Date.now() would make buildContext() impure) —
 * exactly the pattern @aet/domain's own transitionTask(task, next, updatedAt)
 * already uses. See the Phase 4 report for this as a reported gap.
 */
export interface BuildContextInput {
  repositoryRoot: string;
  taskId: TaskId;
  contextPackId: ContextPackId;
  taskDescription: string;
  maxContextTokens: number;
  createdAt: string;
  agentExecutionId?: AgentExecutionId | null;
}

export interface ContextBuildResult {
  contextPack: ContextPack;
  /** Every scanned candidate, selected or not, in ranked order — the explainability trail domain's ContextPack has no field for. */
  candidates: readonly ContextCandidate[];
  repositorySummary: RepositorySummary;
}

export interface ContextEngine {
  buildContext(input: BuildContextInput): ContextBuildResult;
}
