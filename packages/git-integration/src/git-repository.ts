import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TaskId } from '@aet/domain';
import simpleGit, { CheckRepoActions, type SimpleGit } from 'simple-git';
import { AiWorktree } from './ai-worktree.js';
import {
  BranchAlreadyExistsError,
  CleanupError,
  InvalidRepositoryError,
  WorktreeAlreadyExistsError,
  WorktreeCreationError
} from './errors.js';
import { buildAiBranchName, sanitizeGitRefSegment } from './paths.js';
import type { GitOperationResult, RepositoryDescriptor, RepositoryStatus } from './types.js';

async function detectDefaultBranch(git: SimpleGit, currentBranch: string): Promise<string> {
  try {
    const originHead = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    const match = /refs\/remotes\/origin\/(.+)$/.exec(originHead.trim());
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // No remote, or no origin/HEAD symref recorded — fall through to local heuristics.
  }

  const branches = await git.branchLocal();
  if (branches.all.includes('main')) return 'main';
  if (branches.all.includes('master')) return 'master';
  return currentBranch;
}

/**
 * Validates that `repositoryPath` exists, is a directory, and is the root
 * of a real git repository, then resolves its canonical (symlink-free)
 * path and detects its default branch. Never trusts the input path — this
 * is the boundary where a bad path is turned into a typed rejection rather
 * than an obscure fs/git error surfacing later.
 */
export async function validateRepository(repositoryPath: string): Promise<RepositoryDescriptor> {
  if (!existsSync(repositoryPath)) {
    throw new InvalidRepositoryError(repositoryPath, 'path does not exist');
  }

  let stats;
  try {
    stats = statSync(repositoryPath);
  } catch (error) {
    throw new InvalidRepositoryError(repositoryPath, 'path could not be inspected', { cause: error });
  }
  if (!stats.isDirectory()) {
    throw new InvalidRepositoryError(repositoryPath, 'path is not a directory');
  }

  const canonicalPath = realpathSync(repositoryPath);
  const git = simpleGit(canonicalPath);

  let isRepoRoot: boolean;
  try {
    isRepoRoot = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
  } catch (error) {
    throw new InvalidRepositoryError(repositoryPath, 'git could not inspect this path', { cause: error });
  }
  if (!isRepoRoot) {
    throw new InvalidRepositoryError(repositoryPath, 'not the root of a git repository');
  }

  let currentBranch: string;
  try {
    currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  } catch (error) {
    throw new InvalidRepositoryError(repositoryPath, 'repository HEAD could not be resolved', { cause: error });
  }

  const defaultBranch = await detectDefaultBranch(git, currentBranch);

  return { path: canonicalPath, defaultBranch };
}

/**
 * Scaffolds a brand-new git repository at `repositoryPath` when the caller
 * has no existing folder to point at (Phase 21: a task submitted with no
 * repository selected means "start a new project," not "work in an
 * existing one"). `createWorktree()` later needs `revparse(this.defaultBranch)`
 * to resolve to a real commit, and `validateRepository()` needs HEAD to be
 * born — an empty `git init` alone satisfies neither, so this always
 * produces one initial commit (a minimal README) before handing back. The
 * commit author is set locally on this repository only (never touches the
 * host's global git config), so this never depends on git already being
 * configured with a user identity in this environment.
 */
export async function initializeNewRepository(repositoryPath: string, name: string): Promise<RepositoryDescriptor> {
  if (existsSync(repositoryPath)) {
    throw new InvalidRepositoryError(repositoryPath, 'a folder already exists at this path');
  }

  mkdirSync(repositoryPath, { recursive: true });
  const git = simpleGit(repositoryPath);

  try {
    await git.init();
    await git.addConfig('user.name', 'AI Engineering Team', false, 'local');
    await git.addConfig('user.email', 'ai-engineering-team@local', false, 'local');
    writeFileSync(join(repositoryPath, 'README.md'), `# ${name}\n`, 'utf8');
    await git.add('README.md');
    await git.commit('Initial commit');
  } catch (error) {
    throw new InvalidRepositoryError(repositoryPath, 'failed to initialize a new git repository', { cause: error });
  }

  return validateRepository(repositoryPath);
}

/**
 * A validated handle on the user's repository. Every AI task's isolated
 * worktree is created through this handle; the handle itself never writes
 * to the repository's own checked-out working tree.
 */
export class GitRepository {
  private readonly git: SimpleGit;

  constructor(
    readonly path: string,
    readonly defaultBranch: string,
    private readonly worktreeRoot: string
  ) {
    this.git = simpleGit(path);
  }

  /**
   * Opens and validates `repositoryPath`; `worktreeRoot` is an
   * application-controlled directory, never user/LLM input.
   *
   * `worktreeRoot` is resolved to an absolute path here, once, rather than
   * stored as given. `createWorktree()` below passes it to `git worktree
   * add`, which resolves a relative path against the underlying `git`
   * process's own cwd — the REPOSITORY's directory (`this.git = simpleGit(path)`),
   * not this Node process's cwd. `AiWorktree`'s own `simpleGit(worktreePath)`
   * binding, by contrast, resolves a relative path against this process's
   * cwd. A relative `worktreeRoot` (e.g. the config default `./data/worktrees`)
   * therefore meant git physically created the worktree under
   * `<repositoryPath>/data/worktrees/...` while `AiWorktree` went looking for
   * it under `<process-cwd>/data/worktrees/...` — two different directories —
   * and failed with "Cannot use simple-git on a directory that does not
   * exist" the moment any repository lived outside the process's own cwd
   * (which is always true for a project's generated/registered repository).
   * Resolving once here makes every later `join(this.worktreeRoot, ...)`
   * cwd-independent, so both sides agree on the same real path.
   */
  static async open(
    repositoryPath: string,
    worktreeRoot: string
  ): Promise<{ repository: GitRepository; operation: GitOperationResult }> {
    const descriptor = await validateRepository(repositoryPath);
    const resolvedWorktreeRoot = resolve(worktreeRoot);
    mkdirSync(resolvedWorktreeRoot, { recursive: true });

    const operation: GitOperationResult = {
      type: 'REPOSITORY_VALIDATED',
      occurredAt: new Date().toISOString(),
      repositoryPath: descriptor.path,
      defaultBranch: descriptor.defaultBranch
    };

    return { repository: new GitRepository(descriptor.path, descriptor.defaultBranch, resolvedWorktreeRoot), operation };
  }

  /** Live current branch of the user's own checked-out working tree — queried fresh each call. */
  async getCurrentBranch(): Promise<string> {
    return (await this.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  }

  /** Detected once at open() time and cached; git has no single authoritative "default branch" concept locally. */
  getDefaultBranch(): string {
    return this.defaultBranch;
  }

  /**
   * Reports the user's working tree state — never decides whether it's
   * safe to proceed. That policy call belongs to the future Orchestrator.
   */
  async getStatus(): Promise<RepositoryStatus> {
    const status = await this.git.status();
    return {
      currentBranch: status.current,
      isClean: status.isClean(),
      hasStagedChanges: status.staged.length > 0,
      hasUnstagedChanges: status.modified.length > 0 || status.deleted.length > 0 || status.conflicted.length > 0,
      hasUntrackedFiles: status.not_added.length > 0
    };
  }

  /**
   * Creates an isolated worktree at `<worktreeRoot>/<sanitized-task-id>-<executionSequence>/`
   * on a new branch `ai/<sanitized-task-id>-<sanitized-slug>-<executionSequence>`, branched
   * from the repository's detected default branch. Never touches the
   * user's own checked-out working tree or HEAD.
   *
   * `executionSequence` (Phase 18) is the 1-indexed count of this task's
   * WorkflowExecutions so far, including the one currently being started —
   * the caller (Orchestrator) computes it from persistence, since this
   * package has no notion of executions/persistence itself. Without a
   * per-execution-unique path/branch, a task's second execution (e.g.
   * after a Phase 16 HUMAN_REVIEW -> PLANNING rejection) would collide
   * with artifacts its first execution left behind.
   */
  async createWorktree(
    taskId: TaskId,
    slug: string,
    executionSequence: number
  ): Promise<{ worktree: AiWorktree; operation: GitOperationResult }> {
    const branchName = buildAiBranchName(taskId, slug, executionSequence);
    const worktreePath = join(this.worktreeRoot, `${sanitizeGitRefSegment(taskId)}-${executionSequence}`);

    if (existsSync(worktreePath)) {
      throw new WorktreeAlreadyExistsError(worktreePath);
    }

    const branches = await this.git.branchLocal();
    if (branches.all.includes(branchName)) {
      throw new BranchAlreadyExistsError(branchName);
    }

    const baseCommitSha = (await this.git.revparse([this.defaultBranch])).trim();

    try {
      await this.git.raw(['worktree', 'add', '-b', branchName, worktreePath, this.defaultBranch]);
    } catch (error) {
      throw new WorktreeCreationError(`Failed to create worktree for task ${taskId}`, { cause: error });
    }

    const worktree = new AiWorktree(taskId, branchName, worktreePath, baseCommitSha);

    const operation: GitOperationResult = {
      type: 'WORKTREE_CREATED',
      occurredAt: new Date().toISOString(),
      taskId,
      branchName,
      worktreePath,
      baseBranch: this.defaultBranch
    };

    return { worktree, operation };
  }

  /**
   * Reconstructs a handle to an already-created worktree from previously
   * recorded, trusted coordinates (Phase 17) — never from client/user
   * input. Callers must only pass coordinates that were themselves
   * produced by a prior `createWorktree()` call and durably recorded by
   * the application (see `@aet/persistence`'s `ExecutionWorktreeRecord`).
   * Does no filesystem/git I/O itself, exactly like `AiWorktree`'s own
   * constructor — if the worktree no longer exists on disk, that surfaces
   * as a `WorktreeUnavailableError` the first time a real git operation
   * (e.g. `getStructuredDiff()`) is attempted against it, not here.
   */
  resolveWorktree(coordinates: { taskId: TaskId; branchName: string; worktreePath: string; baseCommitSha: string }): AiWorktree {
    return new AiWorktree(coordinates.taskId, coordinates.branchName, coordinates.worktreePath, coordinates.baseCommitSha);
  }

  /**
   * Removes the worktree's working directory and git's administrative
   * record of it. Never deletes the branch — the AI's commits stay
   * reachable for later inspection/push even after the worktree is gone.
   * Explicit only: nothing in this package calls this automatically.
   * Defaults to failing if the worktree has uncommitted changes; pass
   * `force: true` to remove regardless.
   */
  async removeWorktree(
    worktree: AiWorktree,
    options: { force?: boolean } = {}
  ): Promise<{ operation: GitOperationResult }> {
    const args = ['worktree', 'remove', worktree.path];
    if (options.force === true) {
      args.push('--force');
    }

    try {
      await this.git.raw(args);
    } catch (error) {
      throw new CleanupError(`Failed to remove worktree at ${worktree.path}`, { cause: error });
    }

    return {
      operation: {
        type: 'WORKTREE_REMOVED',
        occurredAt: new Date().toISOString(),
        taskId: worktree.taskId,
        worktreePath: worktree.path
      }
    };
  }
}
