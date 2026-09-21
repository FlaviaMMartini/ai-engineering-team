import { useId, useState } from 'react';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ApiError } from '../api/client.js';
import { registerRepository } from '../api/projects.js';
import type { RepositoryDto } from '../types/api.js';
import { ErrorState } from './ErrorState.js';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export interface ProjectRepositoriesProps {
  projectId: string | null;
  repositories: readonly RepositoryDto[];
  loading: boolean;
  error: string | null;
  onRegistered: () => void;
}

/**
 * Phase 21 (repository selection): lets the user point the AI team at an
 * EXISTING local repository (validated as a real git repo server-side —
 * see composition-root.ts's `registerRepository`) instead of always
 * scaffolding a new one. The task creation dialog offers "New project"
 * alongside whatever is registered here.
 */
export function ProjectRepositories({ projectId, repositories, loading, error, onRegistered }: ProjectRepositoriesProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const nameFieldId = useId();
  const pathFieldId = useId();

  async function handleRegister(): Promise<void> {
    if (projectId === null || registering) return;
    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    if (trimmedName.length === 0 || trimmedPath.length === 0) return;

    setRegistering(true);
    setRegisterError(null);
    try {
      await registerRepository(projectId, { name: trimmedName, path: trimmedPath });
      setName('');
      setPath('');
      onRegistered();
    } catch (registerErr) {
      setRegisterError(messageFor(registerErr, 'Unable to register repository.'));
    } finally {
      setRegistering(false);
    }
  }

  if (projectId === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        Select a project first.
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      {loading && (
        <Typography variant="body2" color="text.secondary">
          Loading repositories…
        </Typography>
      )}
      {error !== null && <ErrorState message={error} />}

      {!loading && repositories.length > 0 && (
        <List dense disablePadding sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
          {repositories.map((repository) => (
            <ListItem key={repository.id} divider>
              <ListItemText
                primary={repository.name}
                secondary={repository.localPath}
                slotProps={{ secondary: { sx: { fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' } } }}
              />
            </ListItem>
          ))}
        </List>
      )}
      {!loading && repositories.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No repositories registered yet — tasks will start a brand-new project unless you register one.
        </Typography>
      )}

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        <TextField
          id={nameFieldId}
          size="small"
          label="Repository name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="my-existing-app"
          disabled={registering}
        />
        <TextField
          id={pathFieldId}
          size="small"
          label="Local path (on this machine)"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="C:\path\to\repo"
          disabled={registering}
          sx={{ flex: 1, minWidth: 220 }}
        />
        <Button
          variant="contained"
          onClick={() => void handleRegister()}
          disabled={registering || name.trim().length === 0 || path.trim().length === 0}
        >
          {registering ? 'Registering…' : 'Register'}
        </Button>
      </Stack>
      {registerError !== null && <ErrorState message={registerError} />}
    </Stack>
  );
}
