import type Database from 'better-sqlite3';

/**
 * Runs `fn` inside a single SQLite transaction: commits if `fn` returns
 * normally, rolls back everything if it throws. Not a generic
 * unit-of-work framework — just better-sqlite3's built-in transaction
 * wrapper, invoked immediately, so repository calls made inside `fn`
 * participate in one atomic write.
 */
export type TransactionRunner = <T>(fn: () => T) => T;

export function createTransactionRunner(db: Database.Database): TransactionRunner {
  return <T>(fn: () => T): T => db.transaction(fn)();
}
