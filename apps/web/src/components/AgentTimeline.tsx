import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { AgentExecutionDto } from '../types/api.js';
import { AgentExecutionCard } from './AgentExecutionCard.js';

export interface AgentTimelineProps {
  agents: readonly AgentExecutionDto[];
}

export function AgentTimeline({ agents }: AgentTimelineProps) {
  if (agents.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No agent executions yet.
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5}>
      {agents.map((agent) => (
        <AgentExecutionCard key={agent.id} agent={agent} />
      ))}
    </Stack>
  );
}
