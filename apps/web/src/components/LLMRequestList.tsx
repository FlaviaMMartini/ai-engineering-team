import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { LLMRequestDto } from '../types/api.js';
import { formatCost, formatDuration, formatStatusLabel, formatTimestamp, formatTokenCount } from '../utils/format.js';

export interface LLMRequestListProps {
  requests: readonly LLMRequestDto[];
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Grid size={{ xs: 6, sm: 3 }}>
      <Stack>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {value}
        </Typography>
      </Stack>
    </Grid>
  );
}

/**
 * Renders only fields the backend's LLMRequestDto exposes. It intentionally
 * has no `providerReportedUsage` field — the backend deliberately does not
 * expose it publicly (see apps/api/src/http/types.ts's Phase 14 note), so
 * there is nothing to render here even if it existed on the type.
 */
export function LLMRequestList({ requests }: LLMRequestListProps) {
  if (requests.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No LLM requests recorded yet.
      </Typography>
    );
  }

  return (
    <Stack spacing={1}>
      {requests.map((request) => (
        <Accordion key={request.id} disableGutters variant="outlined">
          <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
            <Typography variant="body2">
              <code>{request.provider}</code> / <code>{request.model}</code> — {formatStatusLabel(request.purpose)}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Field label="Input tokens" value={formatTokenCount(request.usage.input)} />
              <Field label="Output tokens" value={formatTokenCount(request.usage.output)} />
              <Field label="Cache creation" value={formatTokenCount(request.usage.cacheCreation)} />
              <Field label="Cache read" value={formatTokenCount(request.usage.cacheRead)} />
              <Field label="Calculated cost" value={formatCost(request.cost.calculated, request.cost.currency)} />
              <Field label="Started" value={formatTimestamp(request.startedAt)} />
              <Field label="Duration" value={formatDuration(request.startedAt, request.completedAt)} />
            </Grid>
          </AccordionDetails>
        </Accordion>
      ))}
    </Stack>
  );
}
