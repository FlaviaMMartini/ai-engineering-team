import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import type { ExecutionDetailsResponseBody, TaskDto } from '../types/api.js';
import { formatTimestamp } from '../utils/format.js';
import { taskStatusColor } from '../utils/status.js';
import { AgentTimeline } from './AgentTimeline.js';
import { ErrorState } from './ErrorState.js';
import { HumanReviewPanel } from './HumanReviewPanel.js';
import { MetricsSummary } from './MetricsSummary.js';
import { WorkflowStatus } from './WorkflowStatus.js';

export interface TaskDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  task: TaskDto | null;
  details: ExecutionDetailsResponseBody | null;
  notExecuted: boolean;
  loading: boolean;
  error: string | null;
  executing: boolean;
  executeError: string | null;
  onExecute: () => void;
  onReviewed: () => void;
}

/**
 * The Jira-style "issue detail" panel: slides in from the right when a
 * board card is clicked, replacing what used to be a permanently-visible
 * stack of panels below the board. Everything here is read from
 * GET /tasks/:taskId/execution (via useTaskExecution) — this never
 * commands anything itself except the two explicit actions (Execute,
 * Approve/Reject inside HumanReviewPanel).
 */
export function TaskDetailDrawer({
  open,
  onClose,
  task,
  details,
  notExecuted,
  loading,
  error,
  executing,
  executeError,
  onExecute,
  onReviewed
}: TaskDetailDrawerProps) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ '& .MuiDrawer-paper': { width: { xs: '100%', sm: 520 } } }}>
      <Box sx={{ p: 3 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Typography variant="h2" sx={{ pr: 2 }}>
            {task?.description ?? 'Task'}
          </Typography>
          <IconButton onClick={onClose} size="small" aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {task !== null && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
            <Chip size="small" label={task.state.replace(/_/g, ' ')} color={taskStatusColor(task.state)} />
            <Typography variant="caption" color="text.secondary">
              Updated {formatTimestamp(task.updatedAt)}
            </Typography>
          </Stack>
        )}

        {error !== null && <ErrorState message={error} />}
        {details === null && loading && (
          <Typography variant="body2" color="text.secondary">
            Loading execution…
          </Typography>
        )}

        {notExecuted && task !== null && (
          <Stack spacing={1.5} sx={{ my: 2 }}>
            <Typography variant="body2" color="text.secondary">
              This task hasn't been executed yet.
            </Typography>
            <Button variant="contained" onClick={onExecute} disabled={executing} sx={{ alignSelf: 'flex-start' }}>
              {executing ? 'Starting execution…' : 'Execute Task'}
            </Button>
            {executeError !== null && <ErrorState message={executeError} />}
          </Stack>
        )}

        {details !== null && (
          <Stack spacing={3} divider={<Divider />} sx={{ mt: 2 }}>
            <Box>
              <WorkflowStatus status={details.task.status} />
            </Box>

            <Box>
              <Typography variant="h3" sx={{ mb: 1.5 }}>
                Agent Timeline
              </Typography>
              <AgentTimeline agents={details.agents} />
            </Box>

            <HumanReviewPanel
              taskId={details.task.id}
              executionId={details.execution.id}
              taskStatus={details.task.status}
              review={details.review}
              onReviewed={onReviewed}
            />

            <Box>
              <Typography variant="h3" sx={{ mb: 1.5 }}>
                Summary
              </Typography>
              <MetricsSummary
                tokens={details.tokens}
                cost={details.cost}
                context={details.context}
                retries={details.retries}
                llmRequests={details.llmRequests}
              />
            </Box>
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}
