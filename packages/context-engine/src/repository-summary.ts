import { readdirSync } from 'node:fs';
import type { DiscoveredFile, RepositorySummary } from './types.js';

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function detectPackageManager(files: readonly DiscoveredFile[]): 'npm' | 'yarn' | 'pnpm' | null {
  const paths = new Set(files.map((file) => file.relativePath));
  if (paths.has('pnpm-lock.yaml')) return 'pnpm';
  if (paths.has('yarn.lock')) return 'yarn';
  if (paths.has('package-lock.json')) return 'npm';
  return null;
}

function readPackageJsonDependencies(files: readonly DiscoveredFile[]): {
  dependencies: readonly string[];
  devDependencies: readonly string[];
} {
  const packageJson = files.find((file) => file.relativePath === 'package.json');
  if (!packageJson?.content) {
    return { dependencies: [], devDependencies: [] };
  }

  try {
    const parsed = JSON.parse(packageJson.content) as PackageJsonShape;
    return {
      dependencies: Object.keys(parsed.dependencies ?? {}).sort(),
      devDependencies: Object.keys(parsed.devDependencies ?? {}).sort()
    };
  } catch {
    // Malformed package.json: the summary omits dependency info rather than failing the whole build.
    return { dependencies: [], devDependencies: [] };
  }
}

/**
 * Top-level directory names come from a fresh read of the root, not from
 * the (ignore-filtered) discovered file list — so e.g. `node_modules`
 * still shows up by name for orientation, even though nothing inside it
 * was scanned.
 */
function readTopLevelEntries(repositoryRootReal: string): readonly string[] {
  return readdirSync(repositoryRootReal, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

export function buildRepositorySummary(repositoryRootReal: string, files: readonly DiscoveredFile[]): RepositorySummary {
  const { dependencies, devDependencies } = readPackageJsonDependencies(files);
  const hasTypeScriptConfig = files.some(
    (file) => file.relativePath === 'tsconfig.json' || file.relativePath === 'tsconfig.base.json'
  );

  return {
    totalFilesScanned: files.length,
    sourceFileCount: files.filter((file) => file.classification === 'source').length,
    testFileCount: files.filter((file) => file.classification === 'test').length,
    configFileCount: files.filter((file) => file.classification === 'config').length,
    documentationFileCount: files.filter((file) => file.classification === 'documentation').length,
    topLevelEntries: readTopLevelEntries(repositoryRootReal),
    packageManager: detectPackageManager(files),
    dependencies,
    devDependencies,
    hasTypeScriptConfig
  };
}
