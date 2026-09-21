import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { FileNotFoundError, PathOutsideWorktreeError } from './errors.js';

const SLUG_MAX_LENGTH = 50;

/**
 * Reduces arbitrary text to a safe git ref / directory-name segment:
 * lowercase, [a-z0-9-] only, no leading/trailing/repeated dashes, bounded
 * length. Applied to both the task id and the slug — the branch name and
 * worktree directory name are never built from raw, unsanitized input.
 */
export function sanitizeGitRefSegment(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const truncated = normalized.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '');
  return truncated.length === 0 ? 'task' : truncated;
}

/**
 * Deterministic, never LLM-influenced: `ai/<sanitized-task-id>-<sanitized-slug>-<executionSequence>`.
 * `executionSequence` (Phase 18) is the 1-indexed count of this task's
 * WorkflowExecutions, including the current one — the caller's job to
 * compute (see GitRepository.createWorktree()'s doc comment), never
 * inferred here. Without it, a task's second execution (e.g. after a
 * Phase 16 HUMAN_REVIEW -> PLANNING rejection) would collide with its
 * first on both branch name and worktree directory.
 */
export function buildAiBranchName(taskId: string, slug: string, executionSequence: number): string {
  return `ai/${sanitizeGitRefSegment(taskId)}-${sanitizeGitRefSegment(slug)}-${executionSequence}`;
}

function isContained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Resolves `requestedPath` (relative or absolute) against the worktree
 * root, rejecting anything that lexically escapes the root (`../`,
 * an absolute path elsewhere) and anything that escapes it via a symlink
 * once fully resolved. The target must already exist.
 */
export function resolveSafeReadPath(worktreeRoot: string, requestedPath: string): string {
  const worktreeRootReal = realpathSync(worktreeRoot);
  const lexicalTarget = resolve(worktreeRootReal, requestedPath);

  if (!isContained(worktreeRootReal, lexicalTarget)) {
    throw new PathOutsideWorktreeError(requestedPath);
  }

  let realTarget: string;
  try {
    realTarget = realpathSync(lexicalTarget);
  } catch (error) {
    throw new FileNotFoundError(requestedPath, { cause: error });
  }

  if (!isContained(worktreeRootReal, realTarget)) {
    throw new PathOutsideWorktreeError(requestedPath);
  }

  return realTarget;
}

/**
 * Same containment/symlink guarantees as resolveSafeReadPath, but for a
 * target that may not exist yet (a new file being written for the first
 * time). Walks up to the nearest existing ancestor, resolves *that*
 * through any symlinks, verifies it's still inside the worktree, then
 * reappends the not-yet-existing remainder (which by definition cannot
 * itself be a symlink, since nothing exists there yet).
 */
export function resolveSafeWritePath(worktreeRoot: string, requestedPath: string): string {
  const worktreeRootReal = realpathSync(worktreeRoot);
  const lexicalTarget = resolve(worktreeRootReal, requestedPath);

  if (!isContained(worktreeRootReal, lexicalTarget)) {
    throw new PathOutsideWorktreeError(requestedPath);
  }

  let existingAncestor = lexicalTarget;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new PathOutsideWorktreeError(requestedPath);
    }
    existingAncestor = parent;
  }

  const realExistingAncestor = realpathSync(existingAncestor);
  if (!isContained(worktreeRootReal, realExistingAncestor)) {
    throw new PathOutsideWorktreeError(requestedPath);
  }

  const remainder = relative(existingAncestor, lexicalTarget);
  const realTarget = remainder === '' ? realExistingAncestor : resolve(realExistingAncestor, remainder);

  if (!isContained(worktreeRootReal, realTarget)) {
    throw new PathOutsideWorktreeError(requestedPath);
  }

  return realTarget;
}
