import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <Box
      role="status"
      sx={{
        border: '1px dashed',
        borderColor: 'divider',
        borderRadius: 1.5,
        p: 5,
        textAlign: 'center',
        bgcolor: 'background.paper'
      }}
    >
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
    </Box>
  );
}
