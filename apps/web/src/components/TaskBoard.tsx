import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { formatStatusLabel, formatTimestamp } from '../utils/format.js';
import { taskStatusColor } from '../utils/status.js';
import type { TaskDto, TaskStatus } from '../types/api.js';
import { EmptyState } from './EmptyState.js';
import { ErrorState } from './ErrorState.js';

/** Matches domain's TaskState/TASK_TRANSITIONS column order (see AGENT_DESIGN.md's state machine) — BLOCKED/FAILED trail the happy path since they're exception states, not steps in it. */
const COLUMNS: readonly TaskStatus[] = ['BACKLOG', 'PLANNING', 'READY', 'IN_PROGRESS', 'QA', 'HUMAN_REVIEW', 'DONE', 'BLOCKED', 'FAILED'];

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export interface TaskBoardProps {
  tasks: readonly TaskDto[];
  loading: boolean;
  error: string | null;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

/**
 * A Kanban board: every task in the selected project, grouped into one
 * column per `TaskState`. Clicking any card selects it — the caller
 * (Dashboard) opens a detail drawer for whatever's selected.
 */
export function TaskBoard({ tasks, loading, error, selectedTaskId, onSelectTask }: TaskBoardProps) {
  if (error !== null) return <ErrorState message={error} />;
  if (!loading && tasks.length === 0) {
    return <EmptyState title="No tasks yet." description="Click “Create task” above — it will appear here in the Backlog column." />;
  }

  return (
    <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 1 }}>
      {COLUMNS.map((column) => {
        const columnTasks = tasks.filter((task) => task.state === column);
        const color = taskStatusColor(column);
        return (
          <Box key={column} sx={{ flex: '0 0 260px' }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'center',
                mb: 1,
                pb: 1,
                borderBottom: '3px solid',
                borderColor: color === 'default' ? 'divider' : `${color}.main`
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {formatStatusLabel(column)}
              </Typography>
              <Chip size="small" label={columnTasks.length} sx={{ height: 18, fontSize: 11 }} />
            </Stack>
            <Stack spacing={1} sx={{ minHeight: 60 }}>
              {columnTasks.map((task) => (
                <Card key={task.id} variant="outlined" sx={{ borderColor: task.id === selectedTaskId ? 'primary.main' : 'divider' }}>
                  <CardActionArea onClick={() => onSelectTask(task.id)}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        {truncate(task.description, 90)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                        {task.id.slice(0, 8)} · {formatTimestamp(task.updatedAt)}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}
