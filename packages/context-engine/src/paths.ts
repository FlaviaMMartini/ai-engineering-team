import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { InvalidRepositoryRootError } from './errors.js';

/** Validates and canonicalizes a repository root; never trusts the input path. */
export function resolveRepositoryRoot(repositoryRoot: string): string {
  if (!existsSync(repositoryRoot)) {
    throw new InvalidRepositoryRootError(repositoryRoot, 'path does not exist');
  }

  let stats;
  try {
    stats = statSync(repositoryRoot);
  } catch (error) {
    throw new InvalidRepositoryRootError(repositoryRoot, 'path could not be inspected', { cause: error });
  }
  if (!stats.isDirectory()) {
    throw new InvalidRepositoryRootError(repositoryRoot, 'path is not a directory');
  }

  return realpathSync(repositoryRoot);
}

/** `path.relative`-based containment check — never a naive `startsWith`, which mishandles sibling-prefix paths like `/root` vs `/root-evil`. */
export function isPathInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/** Repository-relative paths are always reported with forward slashes, regardless of OS. */
export function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}
