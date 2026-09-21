import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openConnection } from './connection.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aet-persistence-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openConnection', () => {
  it('enables foreign key enforcement', () => {
    const db = openConnection(dbPath);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('enables WAL journal mode for a file-backed database', () => {
    const db = openConnection(dbPath);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
  });

  it('creates every expected table', () => {
    const db = openConnection(dbPath);
    const tables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining(['tasks', 'workflow_executions', 'agent_executions', 'llm_requests', 'context_metrics'])
    );
    db.close();
  });

  it('is idempotent — reopening an existing database file does not fail or duplicate schema application', () => {
    openConnection(dbPath).close();

    expect(() => {
      const second = openConnection(dbPath);
      second.close();
    }).not.toThrow();
  });

  it('data survives closing and reopening the raw connection', () => {
    const first = openConnection(dbPath);
    first
      .prepare(
        `INSERT INTO tasks (id, project_id, repository_id, description, state, retry_count, currency, created_at, updated_at)
         VALUES ('t1', 'p1', 'r1', 'desc', 'BACKLOG', 0, 'USD', 'now', 'now')`
      )
      .run();
    first.close();

    const second = openConnection(dbPath);
    const row = second.prepare<[], { id: string }>("SELECT id FROM tasks WHERE id = 't1'").get();
    expect(row?.id).toBe('t1');
    second.close();
  });

  it('rejects an insert that violates a foreign key constraint', () => {
    const db = openConnection(dbPath);
    expect(() =>
      db
        .prepare(
          `INSERT INTO workflow_executions (id, task_id, status, started_at) VALUES ('wfe-1', 'no-such-task', 'RUNNING', 'now')`
        )
        .run()
    ).toThrow(/FOREIGN KEY/i);
    db.close();
  });
});
