import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectSymlinkSupport } from './test-fixtures.js';
import { FileNotFoundError, PathOutsideWorktreeError } from './errors.js';
import { buildAiBranchName, resolveSafeReadPath, resolveSafeWritePath, sanitizeGitRefSegment } from './paths.js';

const symlinksSupported = detectSymlinkSupport();

describe('sanitizeGitRefSegment', () => {
  it('lowercases and replaces unsafe characters with dashes', () => {
    expect(sanitizeGitRefSegment('Implement JWT Auth!!')).toBe('implement-jwt-auth');
  });

  it('strips leading and trailing dashes', () => {
    expect(sanitizeGitRefSegment('--weird--')).toBe('weird');
  });

  it('never returns an empty string', () => {
    expect(sanitizeGitRefSegment('???')).toBe('task');
  });

  it('truncates very long input to a bounded length', () => {
    expect(sanitizeGitRefSegment('a'.repeat(200)).length).toBeLessThanOrEqual(50);
  });
});

describe('buildAiBranchName', () => {
  it('is deterministic for identical inputs', () => {
    expect(buildAiBranchName('task-123', 'Implement JWT Auth', 1)).toBe(buildAiBranchName('task-123', 'Implement JWT Auth', 1));
  });

  it('sanitizes both the task id and the slug', () => {
    expect(buildAiBranchName('Task/123!', 'weird slug??', 1)).toBe('ai/task-123-weird-slug-1');
  });
});

let dir: string;
let worktreeRoot: string;
let outsideDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aet-paths-'));
  worktreeRoot = join(dir, 'worktree');
  outsideDir = join(dir, 'outside');
  mkdirSync(worktreeRoot, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(worktreeRoot, 'existing.txt'), 'hello', 'utf8');
  writeFileSync(join(outsideDir, 'secret.txt'), 'secret', 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveSafeReadPath', () => {
  it('resolves a plain relative path inside the worktree', () => {
    expect(resolveSafeReadPath(worktreeRoot, 'existing.txt')).toContain('existing.txt');
  });

  it('rejects ../ traversal', () => {
    expect(() => resolveSafeReadPath(worktreeRoot, '../outside/secret.txt')).toThrow(PathOutsideWorktreeError);
  });

  it('rejects an absolute path outside the worktree', () => {
    expect(() => resolveSafeReadPath(worktreeRoot, join(outsideDir, 'secret.txt'))).toThrow(PathOutsideWorktreeError);
  });

  it('rejects a sibling directory that merely shares a name prefix', () => {
    const siblingWithPrefix = `${worktreeRoot}-evil`;
    mkdirSync(siblingWithPrefix, { recursive: true });
    writeFileSync(join(siblingWithPrefix, 'x.txt'), 'x', 'utf8');
    expect(() => resolveSafeReadPath(worktreeRoot, join(siblingWithPrefix, 'x.txt'))).toThrow(PathOutsideWorktreeError);
  });

  it('throws FileNotFoundError for a path that does not exist', () => {
    expect(() => resolveSafeReadPath(worktreeRoot, 'does-not-exist.txt')).toThrow(FileNotFoundError);
  });

  it.skipIf(!symlinksSupported)('rejects a symlink inside the worktree that escapes it', () => {
    symlinkSync(join(outsideDir, 'secret.txt'), join(worktreeRoot, 'escape-link'), 'file');
    expect(() => resolveSafeReadPath(worktreeRoot, 'escape-link')).toThrow(PathOutsideWorktreeError);
  });
});

describe('resolveSafeWritePath', () => {
  it('resolves a new file path inside the worktree', () => {
    expect(resolveSafeWritePath(worktreeRoot, 'new-file.txt')).toContain('new-file.txt');
  });

  it('resolves a new file path inside a not-yet-existing nested directory', () => {
    const resolved = resolveSafeWritePath(worktreeRoot, 'nested/dir/new-file.txt').replace(/\\/g, '/');
    expect(resolved).toContain('nested/dir/new-file.txt');
  });

  it('rejects ../ traversal', () => {
    expect(() => resolveSafeWritePath(worktreeRoot, '../outside/new.txt')).toThrow(PathOutsideWorktreeError);
  });

  it('rejects an absolute path outside the worktree', () => {
    expect(() => resolveSafeWritePath(worktreeRoot, join(outsideDir, 'new.txt'))).toThrow(PathOutsideWorktreeError);
  });

  it('rejects a sibling directory that merely shares a name prefix', () => {
    const siblingWithPrefix = `${worktreeRoot}-evil`;
    mkdirSync(siblingWithPrefix, { recursive: true });
    expect(() => resolveSafeWritePath(worktreeRoot, join(siblingWithPrefix, 'new.txt'))).toThrow(PathOutsideWorktreeError);
  });

  it.skipIf(!symlinksSupported)('rejects writing through a symlinked directory that escapes the worktree', () => {
    symlinkSync(outsideDir, join(worktreeRoot, 'escape-dir'), 'dir');
    expect(() => resolveSafeWritePath(worktreeRoot, 'escape-dir/new.txt')).toThrow(PathOutsideWorktreeError);
  });

  it.skipIf(!symlinksSupported)('does not let a symlinked existing file be "written through" as a new nested path', () => {
    symlinkSync(join(outsideDir, 'secret.txt'), join(worktreeRoot, 'escape-file-link'), 'file');
    expect(() => resolveSafeWritePath(worktreeRoot, 'escape-file-link')).toThrow(PathOutsideWorktreeError);
  });
});
