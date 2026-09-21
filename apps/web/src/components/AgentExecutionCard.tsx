import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { AgentExecutionDto } from '../types/api.js';
import { formatDuration, formatStatusLabel, formatTimestamp } from '../utils/format.js';
import { agentStatusColor, severityColor, type StatusColor } from '../utils/status.js';

export interface AgentExecutionCardProps {
  agent: AgentExecutionDto;
}

interface QAFindingData {
  severity: string;
  description: string;
  relatedFile: string | null;
}

/** Reads a known field off the generic outputArtifact.data bag with a type guard — never trusts its shape blindly, since older executions (before Phase 21's humanSummary/estimatedEffort fields existed) simply won't have these keys. */
function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArrayField(data: Record<string, unknown>, key: string): readonly string[] {
  const value = data[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function findingsField(data: Record<string, unknown>): readonly QAFindingData[] {
  const value = data.findings;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is QAFindingData => {
    if (typeof entry !== 'object' || entry === null) return false;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.severity === 'string' && typeof candidate.description === 'string';
  });
}

/**
 * `agent.status` ('RUNNING'/'SUCCEEDED'/'FAILED') only ever reflects whether
 * the LLM call itself came back without erroring — it says nothing about
 * whether the stage's own outcome actually moved the task forward. A
 * Developer that asks for more context, or a QA pass that finds the
 * implementation fails, is a "SUCCEEDED" agent execution by that definition
 * even though nothing was accomplished — showing that as a plain green
 * "Succeeded" chip reads as "this agent did its job," which is exactly
 * backwards. This layers the outputArtifact's own semantic status (when
 * present) over the raw execution status for display purposes only — it
 * never changes what's actually stored or how the orchestrator behaves.
 */
function deriveDisplayStatus(agent: AgentExecutionDto, data: Record<string, unknown> | null): { label: string; color: StatusColor } {
  if (agent.status !== 'SUCCEEDED' || data === null) {
    return { label: formatStatusLabel(agent.status), color: agentStatusColor(agent.status) };
  }
  const semanticStatus = data.status;
  if (semanticStatus === 'needs_context') {
    return { label: 'Needs context', color: 'warning' };
  }
  if (semanticStatus === 'fail') {
    return { label: 'Tests failed', color: 'warning' };
  }
  return { label: formatStatusLabel(agent.status), color: agentStatusColor(agent.status) };
}

/**
 * Renders one agent's contribution the way a human should read it: a
 * plain-language summary first, role-specific highlights (acceptance
 * criteria for the Architect, files touched for the Developer, findings/
 * backlog ideas for QA), and the full raw JSON tucked into a collapsed
 * "Raw output" section for anyone who wants it. Every field is read
 * defensively (see stringField/stringArrayField/findingsField above) so an
 * older execution missing Phase 21's new humanSummary/estimatedEffort
 * fields still renders sensibly instead of showing "undefined."
 */
export function AgentExecutionCard({ agent }: AgentExecutionCardProps) {
  const data = agent.outputArtifact?.data ?? null;
  const humanSummary = data !== null ? stringField(data, 'humanSummary') : null;
  const estimatedEffort = data !== null ? stringField(data, 'estimatedEffort') : null;
  const acceptanceCriteria = data !== null ? stringArrayField(data, 'acceptanceCriteria') : [];
  const filesChanged = data !== null ? stringArrayField(data, 'filesChanged') : [];
  const findings = data !== null ? findingsField(data) : [];
  const futureImprovements = data !== null ? stringArrayField(data, 'futureImprovements') : [];
  const displayStatus = deriveDisplayStatus(agent, data);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
          <Typography variant="h3">{formatStatusLabel(agent.agentRole)}</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {estimatedEffort !== null && <Chip size="small" label={`~${estimatedEffort}`} variant="outlined" />}
            {agent.retryNumber > 0 && <Chip size="small" label={`Retry ${agent.retryNumber}`} variant="outlined" />}
            {agent.status === 'RUNNING' && <CircularProgress size={14} thickness={5} />}
            <Chip size="small" label={displayStatus.label} color={displayStatus.color} />
          </Stack>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          {formatTimestamp(agent.startedAt)} · {formatDuration(agent.startedAt, agent.completedAt)}
        </Typography>

        {agent.status === 'FAILED' && agent.errorMessage !== null && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {agent.errorMessage}
          </Alert>
        )}

        {humanSummary !== null && (
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            {humanSummary}
          </Typography>
        )}

        {acceptanceCriteria.length > 0 && (
          <Stack sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Acceptance criteria
            </Typography>
            <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
              {acceptanceCriteria.map((criterion) => (
                <Typography key={criterion} component="li" variant="body2">
                  {criterion}
                </Typography>
              ))}
            </Stack>
          </Stack>
        )}

        {filesChanged.length > 0 && (
          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.5 }}>
            {filesChanged.map((path) => (
              <Chip key={path} size="small" label={path} sx={{ fontFamily: 'monospace' }} />
            ))}
          </Stack>
        )}

        {findings.length > 0 && (
          <Stack spacing={0.5} sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Findings
            </Typography>
            {findings.map((finding, index) => (
              // eslint-disable-next-line react/no-array-index-key -- findings have no stable id of their own
              <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <Chip size="small" label={finding.severity} color={severityColor(finding.severity)} />
                <Typography variant="body2">
                  {finding.description}
                  {finding.relatedFile !== null && (
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5, fontFamily: 'monospace' }}>
                      ({finding.relatedFile})
                    </Typography>
                  )}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}

        {futureImprovements.length > 0 && (
          <Stack sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Backlog ideas
            </Typography>
            <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
              {futureImprovements.map((idea) => (
                <Typography key={idea} component="li" variant="body2" color="text.secondary">
                  {idea}
                </Typography>
              ))}
            </Stack>
          </Stack>
        )}

        {agent.outputArtifact !== null && (
          <Accordion disableGutters variant="outlined" sx={{ mt: 1.5, boxShadow: 'none' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
              <Typography variant="caption" color="text.secondary">
                Raw output ({formatStatusLabel(agent.outputArtifact.kind)})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography
                component="pre"
                variant="caption"
                sx={{ m: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto' }}
              >
                {JSON.stringify(agent.outputArtifact.data, null, 2)}
              </Typography>
            </AccordionDetails>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
