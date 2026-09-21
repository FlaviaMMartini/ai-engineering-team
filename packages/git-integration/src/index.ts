export { GitRepository, initializeNewRepository, validateRepository } from './git-repository.js';
export { AiWorktree } from './ai-worktree.js';
export { buildAiBranchName } from './paths.js';

export type {
  CommitResult,
  GitDiff,
  GitFileChange,
  GitOperationResult,
  GitOperationType,
  RepositoryDescriptor,
  RepositoryStatus,
  WorktreeDiff,
  WorktreeDiffFile,
  WorktreeDiffFileStatus
} from './types.js';

export {
  BranchAlreadyExistsError,
  CleanupError,
  CommitError,
  FileNotFoundError,
  GitIntegrationError,
  InvalidRepositoryError,
  PathOutsideWorktreeError,
  WorktreeAlreadyExistsError,
  WorktreeCreationError,
  WorktreeUnavailableError,
  WriteRejectedError
} from './errors.js';
