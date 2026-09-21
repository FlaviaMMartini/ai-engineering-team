import AppBar from '@mui/material/AppBar';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { ProviderStatusChip } from './ProviderStatusChip.js';

export interface AppHeaderProps {
  projectId: string | null;
}

export function AppHeader({ projectId }: AppHeaderProps) {
  return (
    <AppBar position="sticky" elevation={0}>
      <Toolbar sx={{ justifyContent: 'space-between', minHeight: 56, flexWrap: 'wrap', gap: 1, py: 1 }}>
        <Typography variant="h1" component="span" sx={{ fontSize: '1.05rem' }}>
          AI Engineering Team
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <ProviderStatusChip projectId={projectId} />
          <Typography variant="body2" component="span" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            Make Every Token Count.
          </Typography>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
