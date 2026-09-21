import { useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import CloseIcon from '@mui/icons-material/Close';
import type { RepositoryDto } from '../types/api.js';
import { ProjectProviders } from './ProjectProviders.js';
import { ProjectRepositories } from './ProjectRepositories.js';

export interface ProjectSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  repositories: readonly RepositoryDto[];
  repositoriesLoading: boolean;
  repositoriesError: string | null;
  onRepositoryRegistered: () => void;
}

/**
 * Everything project-scoped that isn't "which project" itself (AI provider
 * credentials, registered repositories) lives here instead of always-on
 * page real estate — these are set-up-once actions, not everyday ones, so
 * hiding them behind a dialog is what actually frees up the board below
 * for the thing people look at constantly.
 */
export function ProjectSettingsDialog({
  open,
  onClose,
  projectId,
  repositories,
  repositoriesLoading,
  repositoriesError,
  onRepositoryRegistered
}: ProjectSettingsDialogProps) {
  const [tab, setTab] = useState(0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Project settings
        <IconButton onClick={onClose} size="small" aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <Tabs value={tab} onChange={(_event, value: number) => setTab(value)} sx={{ px: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Tab label="AI Providers" />
        <Tab label="Repositories" />
      </Tabs>
      <DialogContent>
        <Box role="tabpanel" hidden={tab !== 0} sx={{ pt: 1 }}>
          <ProjectProviders projectId={projectId} />
        </Box>
        <Box role="tabpanel" hidden={tab !== 1} sx={{ pt: 1 }}>
          <ProjectRepositories
            projectId={projectId}
            repositories={repositories}
            loading={repositoriesLoading}
            error={repositoriesError}
            onRegistered={onRepositoryRegistered}
          />
        </Box>
      </DialogContent>
    </Dialog>
  );
}
