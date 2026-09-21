import { useEffect, useState } from 'react';
import Chip from '@mui/material/Chip';
import { listProviders } from '../api/projects.js';
import type { ProviderConfigurationDto } from '../types/api.js';

const POLL_INTERVAL_MS = 5000;

export interface ProviderStatusChipProps {
  projectId: string | null;
}

/**
 * Always-visible LLM connection status, in the header where it can't be
 * missed — connecting a provider used to be reachable only through the
 * settings gear, with no ambient signal of whether one was even connected.
 * Polls rather than reacting to an event, matching every other status
 * surface in this app (see useProjectTasks.ts) — connecting/disconnecting
 * happens in the Settings dialog, a few seconds' staleness here is fine.
 */
export function ProviderStatusChip({ projectId }: ProviderStatusChipProps) {
  const [providers, setProviders] = useState<readonly ProviderConfigurationDto[]>([]);

  useEffect(() => {
    setProviders([]);
    if (projectId === null) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function poll(id: string): Promise<void> {
      try {
        const result = await listProviders(id);
        if (cancelled) return;
        setProviders(result.providers);
      } catch {
        // Best-effort status indicator — a transient fetch failure just leaves the last-known chip showing.
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(() => {
            void poll(id);
          }, POLL_INTERVAL_MS);
        }
      }
    }

    void poll(projectId);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [projectId]);

  if (projectId === null) {
    return <Chip size="small" label="No project selected" variant="outlined" />;
  }

  const connected = providers.filter((provider) => provider.status === 'connected');
  if (connected.length === 0) {
    return <Chip size="small" label="No LLM connected" color="error" />;
  }

  return (
    <Chip
      size="small"
      color="success"
      label={`Connected: ${connected.map((provider) => provider.provider).join(', ')}`}
      sx={{ textTransform: 'capitalize' }}
    />
  );
}
