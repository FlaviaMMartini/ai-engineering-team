import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ContextObservabilityDto, CostDto, LLMRequestDto, RetryObservabilityDto, TokenUsageDto } from '../types/api.js';
import { formatCost, formatTokenCount } from '../utils/format.js';
import { ContextMetrics } from './ContextMetrics.js';
import { CostMetrics } from './CostMetrics.js';
import { LLMRequestList } from './LLMRequestList.js';
import { RetryMetrics } from './RetryMetrics.js';
import { TokenMetrics } from './TokenMetrics.js';

export interface MetricsSummaryProps {
  tokens: TokenUsageDto;
  cost: CostDto;
  context: ContextObservabilityDto | null;
  retries: RetryObservabilityDto;
  llmRequests: readonly LLMRequestDto[];
}

function StatCard({ label, value, sublabel = null }: { label: string; value: string; sublabel?: string | null }) {
  return (
    <Grid size={{ xs: 12, sm: 4 }}>
      <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', height: '100%' }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label}
        </Typography>
        <Typography variant="h2" sx={{ mt: 0.5 }}>
          {value}
        </Typography>
        {sublabel !== null && (
          <Typography variant="caption" color="text.secondary">
            {sublabel}
          </Typography>
        )}
      </Box>
    </Grid>
  );
}

/**
 * The friendly, plain-language front-end for what used to be four separate
 * technical panels (Token/Cost/Context/Retry metrics) — a non-technical
 * user should be able to read three numbers and understand "what this
 * cost, in money and in effort." Every underlying figure still comes
 * straight from the backend's already-computed values (see the individual
 * *Metrics components below, kept as-is inside "Technical details" for
 * anyone who wants the raw breakdown) — nothing here is a new calculation
 * except the simple percentage in "contextSavedPercent", which is exactly
 * `estimatedContextAvoidedTokens / estimatedFullRepositoryTokens` restated
 * as a percent for readability.
 */
export function MetricsSummary({ tokens, cost, context, retries, llmRequests }: MetricsSummaryProps) {
  const primaryCost = cost.calculated ?? cost.estimated;
  const costLabel = cost.calculated !== null ? 'Cost' : 'Estimated cost';
  // A null cost isn't always "we don't know" — a free-tier provider (Gemini) genuinely has no
  // per-token price, so composition-root.ts's catalog entry for it sets pricing: null on purpose
  // (see its own doc comment). Distinguishing that from a real gap matters: "Unavailable" reads
  // as broken, "Free" reads as the whole point of using a no-cost provider.
  const ranOnFreeProvider = llmRequests.length > 0 && llmRequests.every((request) => request.cost.calculated === null && request.cost.estimated === null);
  const costValue = primaryCost !== null ? formatCost(primaryCost, cost.currency) : ranOnFreeProvider ? 'Free' : formatCost(null, cost.currency);
  const contextSavedPercent =
    context !== null && context.estimatedFullRepositoryTokens > 0
      ? Math.round((context.estimatedContextAvoidedTokens / context.estimatedFullRepositoryTokens) * 100)
      : null;

  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <StatCard label={costLabel} value={costValue} sublabel={ranOnFreeProvider && primaryCost === null ? 'free tier, no charge' : null} />
        <StatCard label="Tokens used" value={`${formatTokenCount(tokens.total)}`} sublabel="input + output, this execution" />
        <StatCard
          label="Context saved"
          value={contextSavedPercent === null ? '—' : `${contextSavedPercent}%`}
          sublabel={contextSavedPercent === null ? 'Not available yet' : 'less sent to the model vs. the whole repo'}
        />
      </Grid>

      {retries.taskRetryCount > 0 && (
        <Typography variant="body2" color="text.secondary">
          This task needed {retries.taskRetryCount} {retries.taskRetryCount === 1 ? 'retry' : 'retries'}, adding{' '}
          {formatTokenCount(retries.additionalTokens.total)} tokens
          {retries.additionalCalculatedCost !== null ? ` (${formatCost(retries.additionalCalculatedCost, cost.currency)})` : ''}.
        </Typography>
      )}

      <Accordion disableGutters variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2">Technical details</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2} divider={<Divider flexItem />}>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Token usage
              </Typography>
              <TokenMetrics tokens={tokens} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Cost
              </Typography>
              <CostMetrics cost={cost} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Context engine
              </Typography>
              <ContextMetrics context={context} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Retries
              </Typography>
              <RetryMetrics retries={retries} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                LLM requests
              </Typography>
              <LLMRequestList requests={llmRequests} />
            </Box>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}
