import Alert from '@mui/material/Alert';

export interface ErrorStateProps {
  message: string;
}

/** Displays an already-safe, backend/client-produced message — never a raw HTTP body or stack trace. */
export function ErrorState({ message }: ErrorStateProps) {
  return (
    <Alert severity="error" variant="outlined" sx={{ mt: 1 }}>
      {message}
    </Alert>
  );
}
