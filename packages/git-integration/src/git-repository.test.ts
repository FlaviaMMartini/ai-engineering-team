import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BranchAlreadyExistsError,
  InvalidRepositoryError,
  WorktreeAlreadyExistsError
} from './errors.js';
import { GitRepository, validateRepository } from './git-repository.js';
import { cleanupFixtureRepo, createFixtureRepo, type FixtureRepo } from './test-fixtures.js';

let fixture: FixtureRepo;

beforeEach(async () => {
  fixture = await createFixtureRepo();
});

afterEach(() => {
  cleanupFixtureRepo(fixture);
});

describe('validateRepository', () => {
  it('accepts a real git repository and resolves its canonical path plus default branch', async () => {
    const descriptor = await validateRepository(fixture.repoPath);
    expect(descriptor.defaultBranch).toBe('main');
    expect(existsSync(descriptor.path)).toBe(true);
  });

  it('rejects a path that does not exist', async () => {
    await expect(validateRepository(join(fixture.rootDir, 'does-not-exist'))).rejects.toThrow(InvalidRepositoryError);
  });

  it('rejects a path that is a file, not a directory', async () => {
    const filePath = join(fixture.rootDir, 'a-file.txt');
    writeFileSync(filePath, 'x', 'utf8');
    await expect(validateRepository(filePath)).rejects.toThrow(InvalidRepositoryError);
  });

  it('rejects a directory that is not a git repository', async () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'aet-not-a-repo-'));
    try {
      await expect(validateRepository(notARepo)).rejects.toThrow(InvalidRepositoryError);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

describe('GitRepository.open', () => {
  it('opens a validated repository and reports REPOSITORY_VALIDATED', async () => {
    const { repository, operation } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    expect(operation.type).toBe('REPOSITORY_VALIDATED');
    expect(repository.getDefaultBranch()).toBe('main');
  });

  it('reports the current branch of the user repository', async () => {
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    expect(await repository.getCurrentBranch()).toBe('main');
  });
});

describe('GitRepository.getStatus', () => {
  it('reports a clean repository as clean', async () => {
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    const status = await repository.getStatus();
    expect(status.isClean).toBe(true);
    expect(status.hasStagedChanges).toBe(false);
    expect(status.hasUnstagedChanges).toBe(false);
    expect(status.hasUntrackedFiles).toBe(false);
  });

  it('reports uncommitted modifications without discarding them', async () => {
    writeFileSync(join(fixture.repoPath, 'src.txt'), 'modified by the user\n', 'utf8');
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);

    const status = await repository.getStatus();
    expect(status.isClean).toBe(false);
    expect(status.hasUnstagedChanges).toBe(true);

    // The file must still contain the user's edit — nothing in validation/opening touched it.
    expect(readFileSync(join(fixture.repoPath, 'src.txt'), 'utf8')).toBe('modified by the user\n');
  });

  it('reports untracked files', async () => {
    writeFileSync(join(fixture.repoPath, 'new-untracked.txt'), 'new\n', 'utf8');
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    const status = await repository.getStatus();
    expect(status.hasUntrackedFiles).toBe(true);
  });

  it('reports staged changes', async () => {
    writeFileSync(join(fixture.repoPath, 'staged.txt'), 'staged\n', 'utf8');
    await simpleGit(fixture.repoPath).add('staged.txt');
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    const status = await repository.getStatus();
    expect(status.hasStagedChanges).toBe(true);
  });
});

describe('GitRepository.createWorktree', () => {
  it('creates a deterministically named branch and an isolated worktree directory', async () => {
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    const { worktree, operation } = await repository.createWorktree('task-123', 'Implement JWT Auth', 1);

    expect(worktree.branchName).toBe('ai/task-123-implement-jwt-auth-1');
    expect(existsSync(worktree.path)).toBe(true);
    expect(operation.type).toBe('WORKTREE_CREATED');

    const branches = await simpleGit(fixture.repoPath).branchLocal();
    expect(branches.all).toContain('ai/task-123-implement-jwt-auth-1');
  });

  it('never modifies the user-repository working tree or its current branch', async () => {
    writeFileSync(join(fixture.repoPath, 'src.txt'), 'user is actively editing this\n', 'utf8');
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    const branchBefore = await repository.getCurrentBranch();

    await repository.createWorktree('task-456', 'some-task', 1);

    expect(readFileSync(join(fixture.repoPath, 'src.txt'), 'utf8')).toBe('user is actively editing this\n');
    expect(await repository.getCurrentBranch()).toBe(branchBefore);
  });

  it('rejects a worktree collision (same task id and execution sequence used twice)', async () => {
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    await repository.createWorktree('task-dup', 'first-slug', 1);
    await expect(repository.createWorktree('task-dup', 'second-slug', 1)).rejects.toThrow(WorktreeAlreadyExistsError);
  });

  it('rejects a branch collision (branch already exists from elsewhere)', async () => {
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    await simpleGit(fixture.repoPath).raw(['branch', 'ai/task-collide-my-slug-1']);

    await expect(repository.createWorktree('task-collide', 'my-slug', 1)).rejects.toThrow(BranchAlreadyExistsError);
  });
});

describe('GitRepository.removeWorktree', () => {
  it('removes the worktree directory', async () => {
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    const { worktree } = await repository.createWorktree('task-cleanup', 'slug', 1);
    expect(existsSync(worktree.path)).toBe(true);

    const { operation } = await repository.removeWorktree(worktree);

    expect(existsSync(worktree.path)).toBe(false);
    expect(operation.type).toBe('WORKTREE_REMOVED');
  });

  it('does not affect the original repository or its branch', async () => {
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    const { worktree } = await repository.createWorktree('task-cleanup-2', 'slug', 1);
    const branchBefore = await repository.getCurrentBranch();

    await repository.removeWorktree(worktree);

    expect(existsSync(fixture.repoPath)).toBe(true);
    expect(readFileSync(join(fixture.repoPath, 'src.txt'), 'utf8')).toBe('original content\n');
    expect(await repository.getCurrentBranch()).toBe(branchBefore);
  });

  it('does not delete the AI branch — only the worktree directory', async () => {
    const { repository } = await GitRepository.open(fixture.repoPath, fixture.worktreeRoot);
    const { worktree } = await repository.createWorktree('task-cleanup-3', 'slug', 1);

    await repository.removeWorktree(worktree);

    const branches = await simpleGit(fixture.repoPath).branchLocal();
    expect(branches.all).toContain(worktree.branchName);
  });
});
