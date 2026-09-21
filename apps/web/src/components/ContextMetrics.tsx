import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ContextObservabilityDto } from '../types/api.js';
import { formatTokenCount } from '../utils/format.js';

export interface ContextMetricsProps {
  context: ContextObservabilityDto | null;
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Grid size={{ xs: 6, sm: 4 }}>
      <Stack>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', color: accent === true ? 'success.dark' : undefined }}>
          {value}
        </Typography>
      </Stack>
    </Grid>
  );
}

/** Every figure here is read directly from the persisted ContextMetric — never re-scanned or recomputed. */
export function ContextMetrics({ context }: ContextMetricsProps) {
  if (context === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        No context data recorded for this execution yet.
      </Typography>
    );
  }

  return (
    <Grid container spacing={2}>
      <Field label="Full repository (estimated)" value={`${formatTokenCount(context.estimatedFullRepositoryTokens)} tokens`} />
      <Field label="Selected context (estimated)" value={`${formatTokenCount(context.estimatedSelectedContextTokens)} tokens`} />
      <Field label="Context avoided" value={`${formatTokenCount(context.estimatedContextAvoidedTokens)} tokens`} accent />
      <Field label="Files scanned" value={String(context.filesScanned)} />
      <Field label="Files selected" value={String(context.filesSelected)} />
    </Grid>
  );
}
