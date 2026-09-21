export class ContextEngineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ContextEngineError';
  }
}

export class InvalidRepositoryRootError extends ContextEngineError {
  readonly path: string;

  constructor(path: string, reason: string, options?: { cause?: unknown }) {
    super(`Invalid repository root at ${path}: ${reason}`, options);
    this.name = 'InvalidRepositoryRootError';
    this.path = path;
  }
}
