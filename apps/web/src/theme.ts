import { createTheme } from '@mui/material/styles';

/**
 * A light, Jira-like theme: white cards on a soft gray canvas, a blue
 * primary accent, and status colors that match what the task board already
 * needs (success/warning/error map directly to DONE/IN-PROGRESS/FAILED-ish
 * states). Centralized here so every component reads colors from the theme
 * instead of hardcoding hex values — see components' `sx` props.
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0052CC', dark: '#0747A6', light: '#4C9AFF' },
    secondary: { main: '#6554C0' },
    success: { main: '#36B37E', dark: '#00875A' },
    warning: { main: '#FFAB00', dark: '#FF8B00' },
    error: { main: '#DE350B', dark: '#BF2600' },
    background: { default: '#F4F5F7', paper: '#FFFFFF' },
    text: { primary: '#172B4D', secondary: '#6B778C' },
    divider: '#DFE1E6'
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h1: { fontSize: '1.5rem', fontWeight: 700 },
    h2: { fontSize: '1.125rem', fontWeight: 700 },
    h3: { fontSize: '0.9375rem', fontWeight: 700 },
    body2: { fontSize: '0.8125rem' }
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid #DFE1E6',
          boxShadow: 'none'
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600 }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          color: '#172B4D',
          borderBottom: '1px solid #DFE1E6'
        }
      }
    }
  }
});
