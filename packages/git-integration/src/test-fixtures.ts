import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';

export interface FixtureRepo {
  /** Parent temp directory holding both the repo and the worktree root — remove this to clean up everything. */
  rootDir: string;
  repoPath: string;
  worktreeRoot: string;
  defaultBranch: string;
}

/** A real, disposable git repo: initial commit, deterministic default branch, one tracked file. */
export async function createFixtureRepo(): Promise<FixtureRepo> {
  const rootDir = mkdtempSync(join(tmpdir(), 'aet-git-'));
  const repoPath = join(rootDir, 'repo');
  const worktreeRoot = join(rootDir, 'worktrees');
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });

  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.name', 'AET Test');
  await git.addConfig('user.email', 'aet-test@example.com');
  // Deterministic content round-tripping across platforms — otherwise Windows' default
  // autocrlf=true rewrites checked-out LF content to CRLF and every content assertion drifts.
  await git.addConfig('core.autocrlf', 'false');
  // Force a deterministic default branch name regardless of the host's init.defaultBranch config.
  await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);

  writeFileSync(join(repoPath, 'README.md'), '# Fixture repo\n', 'utf8');
  writeFileSync(join(repoPath, 'src.txt'), 'original content\n', 'utf8');
  await git.add('.');
  await git.commit('initial commit');

  return { rootDir, repoPath, worktreeRoot, defaultBranch: 'main' };
}

export function cleanupFixtureRepo(fixture: FixtureRepo): void {
  rmSync(fixture.rootDir, { recursive: true, force: true });
}

/** Probed once, synchronously, so tests can `it.skipIf(!symlinksSupported)` rather than fail on platforms/sandboxes that disallow unprivileged symlink creation. */
export function detectSymlinkSupport(): boolean {
  const probeDir = mkdtempSync(join(tmpdir(), 'aet-symlink-probe-'));
  try {
    writeFileSync(join(probeDir, 'target.txt'), 'x', 'utf8');
    symlinkSync(join(probeDir, 'target.txt'), join(probeDir, 'link.txt'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}
