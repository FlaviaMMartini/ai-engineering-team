export class GitIntegrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GitIntegrationError';
  }
}

export class InvalidRepositoryError extends GitIntegrationError {
  readonly path: string;

  constructor(path: string, reason: string, options?: { cause?: unknown }) {
    super(`Invalid repository at ${path}: ${reason}`, options);
    this.name = 'InvalidRepositoryError';
    this.path = path;
  }
}

export class WorktreeAlreadyExistsError extends GitIntegrationError {
  readonly worktreePath: string;

  constructor(worktreePath: string) {
    super(`Worktree already exists at ${worktreePath}`);
    this.name = 'WorktreeAlreadyExistsError';
    this.worktreePath = worktreePath;
  }
}

export class BranchAlreadyExistsError extends GitIntegrationError {
  readonly branchName: string;

  constructor(branchName: string) {
    super(`Branch already exists: ${branchName}`);
    this.name = 'BranchAlreadyExistsError';
    this.branchName = branchName;
  }
}

export class WorktreeCreationError extends GitIntegrationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorktreeCreationError';
  }
}

export class PathOutsideWorktreeError extends GitIntegrationError {
  readonly requestedPath: string;

  constructor(requestedPath: string) {
    super(`Path resolves outside the worktree: ${requestedPath}`);
    this.name = 'PathOutsideWorktreeError';
    this.requestedPath = requestedPath;
  }
}

export class FileNotFoundError extends GitIntegrationError {
  readonly path: string;

  constructor(path: string, options?: { cause?: unknown }) {
    super(`File not found or unreadable: ${path}`, options);
    this.name = 'FileNotFoundError';
    this.path = path;
  }
}

export class WriteRejectedError extends GitIntegrationError {
  readonly path: string;

  constructor(path: string, reason: string, options?: { cause?: unknown }) {
    super(`Write rejected for ${path}: ${reason}`, options);
    this.name = 'WriteRejectedError';
    this.path = path;
  }
}

export class CommitError extends GitIntegrationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CommitError';
  }
}

export class CleanupError extends GitIntegrationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CleanupError';
  }
}

/** Thrown when a worktree resolved from previously-recorded coordinates (Phase 17) can no longer be read — e.g. its directory was removed. Never leaks the underlying fs/git error message/path. */
export class WorktreeUnavailableError extends GitIntegrationError {
  readonly taskId: string;

  constructor(taskId: string, options?: { cause?: unknown }) {
    super(`Worktree for task ${taskId} is not currently available`, options);
    this.name = 'WorktreeUnavailableError';
    this.taskId = taskId;
  }
}
