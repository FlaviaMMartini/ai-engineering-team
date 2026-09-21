/** Maps a backend status string to the MUI color keyword used everywhere a Chip/icon represents it — one place, so BACKLOG/DONE/FAILED always render the same color regardless of which component shows them. */

export type StatusColor = 'default' | 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';

const TASK_STATUS_COLORS: Record<string, StatusColor> = {
  BACKLOG: 'default',
  PLANNING: 'info',
  READY: 'info',
  IN_PROGRESS: 'primary',
  QA: 'secondary',
  HUMAN_REVIEW: 'warning',
  DONE: 'success',
  FAILED: 'error',
  BLOCKED: 'error'
};

export function taskStatusColor(status: string): StatusColor {
  return TASK_STATUS_COLORS[status] ?? 'default';
}

const AGENT_STATUS_COLORS: Record<string, StatusColor> = {
  SUCCEEDED: 'success',
  FAILED: 'error',
  RUNNING: 'primary'
};

export function agentStatusColor(status: string): StatusColor {
  return AGENT_STATUS_COLORS[status] ?? 'default';
}

const SEVERITY_COLORS: Record<string, StatusColor> = {
  blocker: 'error',
  major: 'warning',
  minor: 'info'
};

export function severityColor(severity: string): StatusColor {
  return SEVERITY_COLORS[severity] ?? 'default';
}
