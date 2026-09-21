export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

export class NotFoundError extends PersistenceError {
  readonly entity: string;
  readonly id: string;

  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
    this.entity = entity;
    this.id = id;
  }
}

export class DuplicateIdError extends PersistenceError {
  readonly entity: string;
  readonly id: string;

  constructor(entity: string, id: string) {
    super(`${entity} already exists: ${id}`);
    this.name = 'DuplicateIdError';
    this.entity = entity;
    this.id = id;
  }
}

export class ForeignKeyViolationError extends PersistenceError {
  constructor(message: string) {
    super(message);
    this.name = 'ForeignKeyViolationError';
  }
}

/**
 * Translates a raw better-sqlite3 failure into one of the typed errors
 * above by its constraint code, so callers of packages/persistence never
 * have to inspect a raw SqliteError. Anything unrecognized is rethrown
 * as-is rather than swallowed or reworded.
 */
export function translateSqliteError(error: unknown, entity: string, id: string): never {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new DuplicateIdError(entity, id);
    }
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      throw new ForeignKeyViolationError(`${entity} ${id} references a row that does not exist`);
    }
  }
  throw error;
}
