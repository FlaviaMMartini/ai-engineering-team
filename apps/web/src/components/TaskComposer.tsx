import { useEffect, useId, useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import type { CreateTaskInput } from '../api/tasks.js';
import type { RepositoryDto } from '../types/api.js';

/** Sentinel `<select>` value for "no repository selected" — never a real repository id, so it can't collide with one. */
const NEW_PROJECT_VALUE = '';

export interface TaskComposerProps {
  open: boolean;
  onClose: () => void;
  submitting: boolean;
  onCreate: (input: CreateTaskInput) => void;
  /** The project selected in the top bar, or null if none is selected yet — the dialog can't be usefully opened without one, see Dashboard.tsx. */
  projectId: string | null;
  /** Registered repositories for `projectId` (see ProjectRepositories.tsx) — offered as the "fix/extend existing code" choice alongside "New project." */
  repositories: readonly RepositoryDto[];
}

/**
 * A Jira-style "Create issue" modal: exposes exactly the fields the
 * backend's `POST /tasks` contract requires (see
 * apps/api/src/http/schemas.ts's createTaskBodySchema) — projectId,
 * description, and either an existing repositoryId or nothing at all
 * ("nothing" tells the backend to scaffold a brand-new repository rather
 * than defaulting to some previously-selected one). No "title" field — the
 * Task domain type has none.
 */
export function TaskComposer({ open, onClose, submitting, onCreate, projectId, repositories }: TaskComposerProps) {
  const [repositorySelection, setRepositorySelection] = useState<string>(NEW_PROJECT_VALUE);
  const [newRepositoryName, setNewRepositoryName] = useState('');
  const [description, setDescription] = useState('');

  const repositoryFieldId = useId();
  const newRepositoryNameFieldId = useId();
  const descriptionFieldId = useId();

  const isNewProject = repositorySelection === NEW_PROJECT_VALUE;
  const canSubmit = projectId !== null && description.trim().length > 0 && !submitting;

  // Reset the form each time the dialog opens, so a previous task's description doesn't linger.
  useEffect(() => {
    if (open) {
      setRepositorySelection(NEW_PROJECT_VALUE);
      setNewRepositoryName('');
      setDescription('');
    }
  }, [open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit || projectId === null) return;

    const trimmedNewRepositoryName = newRepositoryName.trim();
    onCreate({
      projectId,
      description: description.trim(),
      ...(isNewProject ? {} : { repositoryId: repositorySelection }),
      ...(isNewProject && trimmedNewRepositoryName.length > 0 ? { newRepositoryName: trimmedNewRepositoryName } : {})
    });
  }

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Create task</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            {projectId === null && <Alert severity="warning">Select a project above first.</Alert>}

            <FormControl size="small" fullWidth>
              <InputLabel id={repositoryFieldId} shrink>
                Repository
              </InputLabel>
              <Select
                labelId={repositoryFieldId}
                label="Repository"
                notched
                value={repositorySelection}
                onChange={(event) => setRepositorySelection(event.target.value)}
                disabled={submitting}
              >
                <MenuItem value={NEW_PROJECT_VALUE}>New project (start from scratch)</MenuItem>
                {repositories.map((repository) => (
                  <MenuItem key={repository.id} value={repository.id}>
                    {repository.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {isNewProject && (
              <TextField
                id={newRepositoryNameFieldId}
                label="New project name (optional)"
                value={newRepositoryName}
                onChange={(event) => setNewRepositoryName(event.target.value)}
                placeholder="Leave blank to name it from the description"
                disabled={submitting}
                fullWidth
              />
            )}

            <TextField
              id={descriptionFieldId}
              label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe what you want to build..."
              multiline
              minRows={4}
              required
              disabled={submitting}
              fullWidth
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={!canSubmit}>
            {submitting ? 'Creating…' : 'Create Task'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
