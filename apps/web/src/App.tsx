import { useState } from 'react';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { AppHeader } from './components/AppHeader.js';
import { Dashboard } from './pages/Dashboard.js';
import { theme } from './theme.js';

export function App() {
  // Owned here (not inside Dashboard) purely so AppHeader's connection-status chip can show
  // which project's LLM provider is connected — Dashboard remains the source of truth for
  // selection itself and just notifies this via onProjectSelected.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppHeader projectId={selectedProjectId} />
        <Dashboard onProjectSelected={setSelectedProjectId} />
      </Box>
    </ThemeProvider>
  );
}
