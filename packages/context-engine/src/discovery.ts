import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isPathInsideRoot, toPosixPath } from './paths.js';
import type { DiscoveredFile, FileClassification } from './types.js';

export const DEFAULT_IGNORED_DIRECTORIES: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'out',
  'generated'
];

/** The one place an "is this directory ignored" decision gets made — nothing else in this package checks directory names directly. */
export function createIgnoredDirectoryPredicate(ignoredDirectories: readonly string[]): (directoryName: string) => boolean {
  const ignored = new Set(ignoredDirectories);
  return (directoryName: string): boolean => ignored.has(directoryName);
}

const BINARY_PROBE_BYTES = 8000;

function isLikelyBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_PROBE_BYTES).includes(0x00);
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return filename.slice(lastDot).toLowerCase();
}

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.kt',
  '.kts',
  '.swift',
  '.scala'
]);

const DOCUMENTATION_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt']);

const METADATA_FILENAMES = new Set([
  'readme.md',
  'readme',
  'license',
  'license.md',
  'changelog.md',
  'contributing.md',
  '.gitignore',
  '.gitattributes',
  '.editorconfig'
]);

const CONFIG_FILENAMES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example'
]);

const CONFIG_FILENAME_PATTERNS = [
  /^vite\.config\./,
  /^webpack\.config\./,
  /^rollup\.config\./,
  /^jest\.config\./,
  /^vitest\.config\./,
  /^babel\.config\./
];

const TEST_PATH_PATTERNS = [/\.test\./, /\.spec\./, /(^|\/)__tests__(\/|$)/, /(^|\/)tests?(\/|$)/];

/**
 * Lightweight classification, not language parsing — used purely as a
 * relevance signal (see scoring.ts's file-role component).
 */
export function classifyFile(relativePath: string): FileClassification {
  const lowerPath = relativePath.toLowerCase();
  const segments = lowerPath.split('/');
  const filename = segments[segments.length - 1] ?? lowerPath;
  const extension = getExtension(filename);

  if (TEST_PATH_PATTERNS.some((pattern) => pattern.test(lowerPath))) {
    return 'test';
  }
  if (METADATA_FILENAMES.has(filename)) {
    return 'metadata';
  }
  if (CONFIG_FILENAMES.has(filename) || CONFIG_FILENAME_PATTERNS.some((pattern) => pattern.test(filename))) {
    return 'config';
  }
  if (DOCUMENTATION_EXTENSIONS.has(extension)) {
    return 'documentation';
  }
  if (SOURCE_EXTENSIONS.has(extension)) {
    return 'source';
  }
  return 'unknown';
}

/**
 * Deterministic, read-only recursive discovery. Symlinks are never
 * followed (files or directories) — the simplest way to guarantee nothing
 * outside `repositoryRootReal` is ever read, with no per-entry realpath
 * bookkeeping or cycle detection needed. Returns files sorted by
 * normalized relative path, independent of filesystem enumeration order.
 */
export function discoverFiles(repositoryRootReal: string, ignoredDirectories: readonly string[]): readonly DiscoveredFile[] {
  const isIgnoredDirectory = createIgnoredDirectoryPredicate(ignoredDirectories);
  const files: DiscoveredFile[] = [];

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const entryPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) continue;
        walk(entryPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!isPathInsideRoot(repositoryRootReal, entryPath)) continue; // defense in depth; unreachable given symlinks are never followed

      const stats = statSync(entryPath);
      const relativePath = toPosixPath(relative(repositoryRootReal, entryPath));
      const buffer = readFileSync(entryPath);
      const isBinary = isLikelyBinary(buffer);

      files.push({
        relativePath,
        absolutePath: entryPath,
        sizeBytes: stats.size,
        content: isBinary ? null : buffer.toString('utf8'),
        isBinary,
        classification: classifyFile(relativePath)
      });
    }
  }

  walk(repositoryRootReal);

  return [...files].sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
}
