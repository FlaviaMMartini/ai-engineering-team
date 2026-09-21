/** Presentation-only formatting of values the backend already computed/persisted — never a new calculation. */

export function formatTokenCount(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function formatCost(value: number | null, currency: string | null): string {
  if (value === null) return 'Unavailable';
  const prefix = currency === null || currency === 'USD' ? '$' : `${currency} `;
  return `${prefix}${value.toFixed(4)}`;
}

export function formatTimestamp(value: string | null): string {
  if (value === null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  const totalSeconds = Math.round(elapsedMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

/**
 * Elapsed wall-clock time between two already-persisted timestamps — or,
 * while still running (`completedAt === null`), elapsed time so far against
 * the caller's clock right now. That "now" reading is the one place this
 * function isn't purely re-displaying persisted data — it's what turns a
 * static "running" label into a ticking counter as the polling that renders
 * this re-fires every few seconds, which is the whole point: a human
 * watching a multi-minute local-model generation needs to see time moving,
 * not a frozen word, to tell "still working" apart from "stuck."
 */
export function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '—';
  if (completedAt === null) {
    return `${formatElapsed(Math.max(0, Date.now() - start))} so far`;
  }
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(end)) return '—';
  return formatElapsed(Math.max(0, end - start));
}

export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}
