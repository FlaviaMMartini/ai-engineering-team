import { useEffect, useId, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { ApiError } from '../api/client.js';
import { createProject, listProjects } from '../api/projects.js';
import type { ProjectDto } from '../types/api.js';
import { ErrorState } from './ErrorState.js';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export interface ProjectSelectorProps {
  onProjectSelected: (projectId: string | null) => void;
}

/**
 * The always-visible top-bar piece of project management: pick an existing
 * project, or create a new one inline. Everything project-scoped but not
 * "which project" itself (AI providers, repositories) lives behind the
 * Settings dialog instead — see Dashboard.tsx — so this stays a single
 * compact control row rather than the large always-on form it used to be.
 */
export function ProjectSelector({ onProjectSelected }: ProjectSelectorProps) {
  const [projects, setProjects] = useState<readonly ProjectDto[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const [creating, setCreating] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const selectFieldId = useId();
  const newProjectFieldId = useId();

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    onProjectSelected(selectedProjectId.length === 0 ? null : selectedProjectId);
  }, [selectedProjectId]);

  async function refreshProjects(): Promise<void> {
    try {
      const result = await listProjects();
      setProjects(result.projects);
      setProjectsError(null);
    } catch (error) {
      setProjectsError(messageFor(error, 'Unable to load projects.'));
    }
  }

  async function handleCreateProject(): Promise<void> {
    const name = newProjectName.trim();
    if (name.length === 0 || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createProject({ name });
      setNewProjectName('');
      setNewProjectOpen(false);
      await refreshProjects();
      setSelectedProjectId(result.project.id);
    } catch (error) {
      setCreateError(messageFor(error, 'Unable to create project.'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <FormControl size="small" sx={{ minWidth: 220 }}>
        <InputLabel id={selectFieldId} shrink>
          Project
        </InputLabel>
        <Select
          labelId={selectFieldId}
          label="Project"
          notched
          value={selectedProjectId}
          onChange={(event) => setSelectedProjectId(event.target.value)}
          displayEmpty
        >
          <MenuItem value="">
            <em>Select a project…</em>
          </MenuItem>
          {projects.map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {newProjectOpen ? (
        <Stack direction="row" spacing={1}>
          <TextField
            id={newProjectFieldId}
            size="small"
            label="New project name"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            disabled={creating}
            autoFocus
          />
          <Button variant="contained" onClick={() => void handleCreateProject()} disabled={creating || newProjectName.trim().length === 0}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
          <Button variant="text" onClick={() => setNewProjectOpen(false)} disabled={creating}>
            Cancel
          </Button>
        </Stack>
      ) : (
        <Button startIcon={<AddIcon />} onClick={() => setNewProjectOpen(true)} variant="outlined" size="small" sx={{ mt: 0.5 }}>
          New project
        </Button>
      )}

      {projectsError !== null && <ErrorState message={projectsError} />}
      {createError !== null && <ErrorState message={createError} />}
    </Stack>
  );
}
