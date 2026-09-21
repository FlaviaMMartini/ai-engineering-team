import Database from 'better-sqlite3';
import { initializeSchema } from './schema.js';

/**
 * Opens (creating if necessary) the SQLite file at `path`, enables foreign
 * key enforcement and WAL journaling, and applies the schema. `path` may
 * also be `:memory:` for tests.
 */
export function openConnection(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}
