import type { ContextPack } from '@aet/domain';
import type { RepositorySummary } from '@aet/context-engine';

/** Shared by every agent prompt — the one place a ContextPack becomes prompt text, so the format never drifts between agents. */
export function formatContextPackForPrompt(pack: ContextPack): string {
  if (pack.files.length === 0) {
    return '(no files were selected for this context)';
  }
  return pack.files.map((file) => `--- ${file.filePath} ---\n${file.content}`).join('\n\n');
}

export function formatRepositorySummaryForPrompt(summary: RepositorySummary): string {
  const lines = [
    `Total files scanned: ${summary.totalFilesScanned}`,
    `Source files: ${summary.sourceFileCount}, test files: ${summary.testFileCount}, config files: ${summary.configFileCount}, docs: ${summary.documentationFileCount}`,
    `Top-level entries: ${summary.topLevelEntries.join(', ') || '(none)'}`,
    `Package manager: ${summary.packageManager ?? 'unknown'}`,
    `TypeScript config present: ${summary.hasTypeScriptConfig ? 'yes' : 'no'}`
  ];
  // Always shown, even when empty: an omitted line reads as "not computed," but an explicit
  // "(none)" is the unambiguous signal that stops the Architect from assuming a framework (React,
  // a router, etc.) the repository does not actually depend on — see AGENT_DESIGN.md's Architect
  // constraints and the live-testing report that traced a hallucinated React plan to this gap.
  lines.push(`Dependencies: ${summary.dependencies.join(', ') || '(none)'}`);
  lines.push(`Dev dependencies: ${summary.devDependencies.join(', ') || '(none)'}`);
  return lines.join('\n');
}
