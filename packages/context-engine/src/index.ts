export { createContextEngine } from './engine.js';

export type {
  BuildContextInput,
  ContextBuildResult,
  ContextCandidate,
  ContextCandidateDecision,
  ContextEngine,
  ContextEngineOptions,
  ContextSelectionReason,
  DiscoveredFile,
  FileClassification,
  RepositorySummary,
  TokenEstimator
} from './types.js';

export { DEFAULT_IGNORED_DIRECTORIES } from './discovery.js';

export { ContextEngineError, InvalidRepositoryRootError } from './errors.js';
