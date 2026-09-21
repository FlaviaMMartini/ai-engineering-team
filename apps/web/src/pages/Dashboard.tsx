import { useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ApiError } from '../api/client.js';
import { executeTask, type CreateTaskInput, createTask } from '../api/tasks.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorState } from '../components/ErrorState.js';
import { ProjectSelector } from '../components/ProjectSelector.js';
import { ProjectSettingsDialog } from '../components/ProjectSettingsDialog.js';
import { TaskBoard } from '../components/TaskBoard.js';
import { TaskComposer } from '../components/TaskComposer.js';
import { TaskDetailDrawer } from '../components/TaskDetailDrawer.js';
import { useProjectRepositories } from '../hooks/useProjectRepositories.js';
import { useProjectTasks } from '../hooks/useProjectTasks.js';
import { useTaskExecution } from '../hooks/useTaskExecution.js';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export interface DashboardProps {
  /** Lets App.tsx know which project is selected, so the header can show that project's LLM connection status without the whole selection state living up there. */
  onProjectSelected?: (projectId: string | null) => void;
}

export function Dashboard({ onProjectSelected }: DashboardProps = {}) {
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(null);
  const setSelectedProjectId = (projectId: string | null) => {
    setSelectedProjectIdState(projectId);
    onProjectSelected?.(projectId);
  };
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  const { tasks, loading: tasksLoading, error: tasksError } = useProjectTasks(selectedProjectId);
  const {
    repositories,
    loading: repositoriesLoading,
    error: repositoriesError,
    refresh: refreshRepositories
  } = useProjectRepositories(selectedProjectId);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  // Always active for the selected task, even while it's still BACKLOG and this 404s (see
  // useTaskExecution.ts: it already keeps re-checking on a 404 rather than giving up) — an
  // earlier version of this gated polling on the task having left BACKLOG, which also silently
  // disabled `notExecuted`, so the "Execute Task" button never rendered for a fresh task at all.
  // A GET every 2.5s that comes back 404 until the user acts is a real but minor cost, and a
  // strictly smaller problem than a task nobody can ever execute.
  const { details, notExecuted, loading: detailsLoading, error: detailsError, refresh } = useTaskExecution(selectedTaskId);

  async function handleCreate(input: CreateTaskInput): Promise<void> {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createTask(input);
      setComposerOpen(false);
      setSelectedTaskId(result.task.id);
      setExecuteError(null);
    } catch (error) {
      setCreateError(messageFor(error, 'Unable to create task.'));
    } finally {
      setCreating(false);
    }
  }

  async function handleExecute(): Promise<void> {
    if (selectedTask === null || executing) return;
    setExecuting(true);
    setExecuteError(null);
    try {
      const result = await executeTask(selectedTask.id);
      if (result.errorMessage !== null) {
        setExecuteError(result.errorMessage);
      }
      refresh();
    } catch (error) {
      setExecuteError(messageFor(error, 'Unable to execute task.'));
    } finally {
      setExecuting(false);
    }
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <ProjectSelector onProjectSelected={setSelectedProjectId} />
        <Stack direction="row" spacing={1}>
          <Tooltip title="Project settings (AI providers, repositories)">
            <span>
              <IconButton onClick={() => setSettingsOpen(true)} disabled={selectedProjectId === null}>
                <SettingsIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setComposerOpen(true)} disabled={selectedProjectId === null}>
            Create task
          </Button>
        </Stack>
      </Stack>
      {createError !== null && <ErrorState message={createError} />}

      {selectedProjectId === null ? (
        <EmptyState title="No project selected." description="Select or create a project above to see its board." />
      ) : (
        <>
          <Typography variant="h2" sx={{ mb: 2 }}>
            Board
          </Typography>
          <TaskBoard
            tasks={tasks}
            loading={tasksLoading}
            error={tasksError}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        </>
      )}

      <ProjectSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projectId={selectedProjectId}
        repositories={repositories}
        repositoriesLoading={repositoriesLoading}
        repositoriesError={repositoriesError}
        onRepositoryRegistered={refreshRepositories}
      />

      <TaskComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        submitting={creating}
        onCreate={handleCreate}
        projectId={selectedProjectId}
        repositories={repositories}
      />

      <TaskDetailDrawer
        open={selectedTaskId !== null}
        onClose={() => setSelectedTaskId(null)}
        task={selectedTask}
        details={details}
        notExecuted={notExecuted}
        loading={detailsLoading}
        error={detailsError}
        executing={executing}
        executeError={executeError}
        onExecute={() => void handleExecute()}
        onReviewed={refresh}
      />
    </Container>
  );
}
