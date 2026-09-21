import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { RetryObservabilityDto } from '../types/api.js';
import { formatCost, formatTokenCount } from '../utils/format.js';

export interface RetryMetricsProps {
  retries: RetryObservabilityDto;
}

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <Grid size={{ xs: 6, sm: 4 }}>
      <Stack>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', color: muted === true ? 'text.secondary' : undefined }}>
          {value}
        </Typography>
      </Stack>
    </Grid>
  );
}

/** Displays existing retry facts only — no new retry algorithm or score is computed here. */
export function RetryMetrics({ retries }: RetryMetricsProps) {
  return (
    <Grid container spacing={2}>
      <Field label="Task retry count" value={String(retries.taskRetryCount)} />
      <Field label="Agent executions" value={String(retries.agentExecutionCount)} />
      <Field label="LLM requests" value={String(retries.llmRequestCount)} />
      <Field label="Additional tokens from retries" value={formatTokenCount(retries.additionalTokens.total)} />
      <Field
        label="Additional cost from retries"
        value={formatCost(retries.additionalCalculatedCost, null)}
        muted={retries.additionalCalculatedCost === null}
      />
    </Grid>
  );
}
