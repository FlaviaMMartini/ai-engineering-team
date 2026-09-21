import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { CostDto } from '../types/api.js';
import { formatCost } from '../utils/format.js';

export interface CostMetricsProps {
  cost: CostDto;
}

function CostField({ label, value }: { label: string; value: number | null; currency: string | null }) {
  return (
    <Stack>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: value === null ? undefined : 'monospace', color: value === null ? 'text.secondary' : undefined }}>
        {formatCost(value, null)}
      </Typography>
    </Stack>
  );
}

/**
 * Labeled "Calculated cost" — never "Actual cost" or "Billed cost" (see
 * TOKEN_ECONOMY.md: no provider returns a billed dollar figure). Shows
 * "Unavailable" rather than "$0" when the backend has no cost figure.
 */
export function CostMetrics({ cost }: CostMetricsProps) {
  return (
    <Stack direction="row" spacing={4}>
      <CostField label="Estimated cost" value={cost.estimated} currency={cost.currency} />
      <CostField label="Calculated cost" value={cost.calculated} currency={cost.currency} />
    </Stack>
  );
}
