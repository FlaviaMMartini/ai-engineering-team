import { posix } from 'node:path';
import type { ContextSelectionReason, DiscoveredFile } from './types.js';

/**
 * Named, fixed weights (not user-configurable yet) so the total score is
 * always transparently `path*0.4 + content*0.3 + role*0.15 + proximity*0.15`.
 */
export const SCORE_WEIGHTS = {
  path: 0.4,
  content: 0.3,
  role: 0.15,
  proximity: 0.15
} as const;

export interface FileScoreBreakdown {
  score: number;
  reasons: readonly ContextSelectionReason[];
}

function filenameOf(relativePath: string): string {
  const segments = relativePath.split('/');
  return segments[segments.length - 1] ?? relativePath;
}

/**
 * Fraction of distinct task keywords that appear anywhere in the file's
 * path (directories + filename), normalized 0..1 by keyword count — never
 * an unbounded raw match count.
 */
function scorePathSignal(relativePath: string, keywords: readonly string[]): number {
  if (keywords.length === 0) return 0;
  const lowerPath = relativePath.toLowerCase();
  const matched = keywords.filter((keyword) => lowerPath.includes(keyword));
  return matched.length / keywords.length;
}

function filenameHasKeywordMatch(relativePath: string, keywords: readonly string[]): boolean {
  const lowerFilename = filenameOf(relativePath).toLowerCase();
  return keywords.some((keyword) => lowerFilename.includes(keyword));
}

/**
 * Fraction of distinct task keywords present anywhere in the file's
 * content. Presence-only, never a raw occurrence count — a keyword
 * repeated hundreds of times contributes exactly the same as one
 * occurrence, so content length/repetition can't inflate the score.
 */
function scoreContentSignal(content: string | null, keywords: readonly string[]): number {
  if (content === null || keywords.length === 0) return 0;
  const lowerContent = content.toLowerCase();
  const matched = keywords.filter((keyword) => lowerContent.includes(keyword));
  return matched.length / keywords.length;
}

const ROLE_TOKENS: readonly string[] = [
  'middleware',
  'auth',
  'security',
  'user',
  'session',
  'route',
  'controller',
  'service',
  'config',
  'test',
  'model',
  'schema',
  'api',
  'endpoint'
];

/**
 * Only role tokens the TASK's own keywords already flag as relevant count
 * toward this signal — for a task with no role-relevant keywords, this is
 * always 0. Keeps role matching a controlled boost, never a hardcoded
 * "auth files always win" special case, and keeps it from dominating
 * generic tasks (further enforced by the fixed 0.15 weight).
 */
function scoreRoleSignal(relativePath: string, keywords: readonly string[]): number {
  const keywordSet = new Set(keywords);
  const relevantRoleTokens = ROLE_TOKENS.filter((token) => keywordSet.has(token));
  if (relevantRoleTokens.length === 0) return 0;

  const lowerPath = relativePath.toLowerCase();
  const matched = relevantRoleTokens.filter((token) => lowerPath.includes(token));
  return matched.length / relevantRoleTokens.length;
}

/** path + content + role only, normalized to 0..1 — used purely as the "is my neighbor relevant" threshold input for proximity, never shown as a final score. */
function normalizedBaseOf(pathScore: number, contentScore: number, roleScore: number): number {
  const denominator = SCORE_WEIGHTS.path + SCORE_WEIGHTS.content + SCORE_WEIGHTS.role;
  return (pathScore * SCORE_WEIGHTS.path + contentScore * SCORE_WEIGHTS.content + roleScore * SCORE_WEIGHTS.role) / denominator;
}

interface BaseSignals {
  score: number;
  normalizedBase: number;
  reasons: readonly ContextSelectionReason[];
}

function scoreBaseSignals(file: DiscoveredFile, keywords: readonly string[]): BaseSignals {
  const pathScore = scorePathSignal(file.relativePath, keywords);
  const contentScore = scoreContentSignal(file.content, keywords);
  const roleScore = scoreRoleSignal(file.relativePath, keywords);

  const reasons: ContextSelectionReason[] = [];
  if (pathScore > 0) reasons.push('path_match');
  if (filenameHasKeywordMatch(file.relativePath, keywords)) reasons.push('filename_match');
  if (contentScore > 0) reasons.push('content_match');
  if (roleScore > 0) reasons.push('file_role_match');

  return {
    score: pathScore * SCORE_WEIGHTS.path + contentScore * SCORE_WEIGHTS.content + roleScore * SCORE_WEIGHTS.role,
    normalizedBase: normalizedBaseOf(pathScore, contentScore, roleScore),
    reasons
  };
}

// --- Lightweight import/reference graph (no parser, no AST, no ts-morph) ---

const IMPORT_PATTERNS: readonly RegExp[] = [
  /import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g
];

function extractImportSpecifiers(content: string): readonly string[] {
  const specifiers = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match !== null) {
      const specifier = match[1];
      if (specifier) specifiers.add(specifier);
      match = pattern.exec(content);
    }
  }
  return [...specifiers];
}

const RESOLVABLE_SUFFIXES: readonly string[] = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

/** Only relative specifiers (`./foo`, `../bar`) can map to a repository file — bare package imports (`react`, `@aet/domain`) never do. */
function resolveRelativeImport(importerRelativePath: string, specifier: string, knownPaths: ReadonlySet<string>): string | null {
  if (!specifier.startsWith('.')) return null;

  const importerDir = posix.dirname(importerRelativePath);
  const joined = posix.normalize(posix.join(importerDir, specifier));

  for (const suffix of RESOLVABLE_SUFFIXES) {
    const candidate = `${joined}${suffix}`;
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function pushNeighbor(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

/** Undirected: a file is "connected" to what it imports AND to what imports it. */
function buildImportNeighbors(files: readonly DiscoveredFile[]): ReadonlyMap<string, readonly string[]> {
  const knownPaths = new Set(files.map((file) => file.relativePath));
  const neighbors = new Map<string, string[]>();

  for (const file of files) {
    if (file.content === null) continue;
    const specifiers = extractImportSpecifiers(file.content);
    for (const specifier of specifiers) {
      const resolved = resolveRelativeImport(file.relativePath, specifier, knownPaths);
      if (resolved === null || resolved === file.relativePath) continue;
      pushNeighbor(neighbors, file.relativePath, resolved);
      pushNeighbor(neighbors, resolved, file.relativePath);
    }
  }

  const deduped = new Map<string, readonly string[]>();
  for (const [path, values] of neighbors) {
    deduped.set(path, [...new Set(values)].sort());
  }
  return deduped;
}

const PROXIMITY_RELEVANCE_THRESHOLD = 0.3;

/**
 * A file gets credit for being adjacent (imports or is imported by) to the
 * single most relevant neighbor that clears a minimum relevance bar —
 * never an iterative/converging graph algorithm, just one lookup per file
 * against already-computed base scores.
 */
function scoreProximitySignal(neighbors: readonly string[], normalizedBaseByPath: ReadonlyMap<string, number>): number {
  let best = 0;
  for (const neighborPath of neighbors) {
    const neighborBase = normalizedBaseByPath.get(neighborPath) ?? 0;
    if (neighborBase >= PROXIMITY_RELEVANCE_THRESHOLD && neighborBase > best) {
      best = neighborBase;
    }
  }
  return best;
}

/**
 * Scores every discovered file. Two passes: base signals (path/content/role)
 * first, then proximity — computed only from neighbors' base scores, never
 * from other files' proximity scores, so there's no circularity or
 * iterative convergence to reason about.
 */
export function scoreAllCandidates(
  files: readonly DiscoveredFile[],
  keywords: readonly string[]
): ReadonlyMap<string, FileScoreBreakdown> {
  const baseByPath = new Map<string, BaseSignals>();
  for (const file of files) {
    baseByPath.set(file.relativePath, scoreBaseSignals(file, keywords));
  }

  const normalizedBaseByPath = new Map<string, number>();
  for (const [path, base] of baseByPath) {
    normalizedBaseByPath.set(path, base.normalizedBase);
  }

  const neighborsByPath = buildImportNeighbors(files);

  const result = new Map<string, FileScoreBreakdown>();
  for (const file of files) {
    const base = baseByPath.get(file.relativePath);
    if (!base) continue; // unreachable: every file has a base entry from the loop above

    const neighbors = neighborsByPath.get(file.relativePath) ?? [];
    const proximityScore = scoreProximitySignal(neighbors, normalizedBaseByPath);

    const totalScore = Math.min(base.score + proximityScore * SCORE_WEIGHTS.proximity, 1);
    const reasons = proximityScore > 0 ? [...base.reasons, 'relationship_match' as const] : base.reasons;

    result.set(file.relativePath, { score: totalScore, reasons });
  }

  return result;
}
