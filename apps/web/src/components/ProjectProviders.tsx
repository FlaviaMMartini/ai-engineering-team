import { useEffect, useId, useState } from 'react';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ApiError } from '../api/client.js';
import { connectProvider, disconnectProvider, listProviders, validateProvider } from '../api/projects.js';
import type { ProviderConfigurationDto } from '../types/api.js';
import { ErrorState } from './ErrorState.js';

const KNOWN_PROVIDERS = ['anthropic', 'gemini'] as const;

const CONNECTION_FIELD: Record<
  (typeof KNOWN_PROVIDERS)[number],
  { label: string; placeholder: string; inputType: 'password' | 'text'; defaultValue?: string }
> = {
  anthropic: { label: 'Anthropic API key', placeholder: 'sk-ant-...', inputType: 'password' },
  // Google AI Studio (https://aistudio.google.com/apikey) issues these — the genuinely free way
  // to use Gemini, no billing account required.
  gemini: { label: 'Gemini API key', placeholder: 'AIza...', inputType: 'password' }
};

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function statusFor(providers: readonly ProviderConfigurationDto[], provider: string): string {
  return providers.find((entry) => entry.provider === provider)?.status ?? 'not_configured';
}

const STATUS_COLOR: Record<string, 'success' | 'error' | 'default'> = {
  connected: 'success',
  invalid: 'error'
};

/**
 * BYOK UI (Phase 19/21): connect or remove a provider credential for
 * `projectId`. The API key never leaves the connect form's local state
 * except in the one POST request that submits it — it is cleared from
 * state immediately after that request settles (success or failure alike),
 * never written to localStorage/sessionStorage, never put in a URL, and
 * never redisplayed. This component only ever holds
 * connected/not_configured/invalid status strings, never a key. Project
 * selection itself lives in ProjectSelector.tsx — this component only ever
 * receives an already-chosen `projectId`.
 */
export interface ProjectProvidersProps {
  projectId: string | null;
}

export function ProjectProviders({ projectId }: ProjectProvidersProps) {
  const [providers, setProviders] = useState<readonly ProviderConfigurationDto[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);

  // Keyed by provider name: each provider's connect form is fully independent — typing into
  // Gemini's field, an error connecting Anthropic, or an in-flight request for one must never
  // bleed into the other's form.
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [connectErrors, setConnectErrors] = useState<Record<string, string>>({});
  const [actionPending, setActionPending] = useState<string | null>(null);

  const apiKeyFieldIdBase = useId();

  useEffect(() => {
    if (projectId === null) {
      setProviders([]);
      return;
    }
    void refreshProviders(projectId);
  }, [projectId]);

  async function refreshProviders(id: string): Promise<void> {
    setProvidersLoading(true);
    setProvidersError(null);
    try {
      const result = await listProviders(id);
      setProviders(result.providers);
    } catch (error) {
      setProvidersError(messageFor(error, 'Unable to load provider status.'));
    } finally {
      setProvidersLoading(false);
    }
  }

  async function handleConnect(provider: string): Promise<void> {
    if (projectId === null || connectingProvider !== null) return;
    const apiKey = apiKeyInputs[provider] ?? CONNECTION_FIELD[provider as keyof typeof CONNECTION_FIELD]?.defaultValue ?? '';
    setConnectingProvider(provider);
    setConnectErrors((prev) => ({ ...prev, [provider]: '' }));
    try {
      await connectProvider(projectId, provider, apiKey);
      await refreshProviders(projectId);
    } catch (error) {
      setConnectErrors((prev) => ({ ...prev, [provider]: messageFor(error, 'Unable to connect provider.') }));
    } finally {
      setApiKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      setConnectingProvider(null);
    }
  }

  async function handleDisconnect(provider: string): Promise<void> {
    if (projectId === null || actionPending !== null) return;
    setActionPending(`disconnect:${provider}`);
    try {
      await disconnectProvider(projectId, provider);
      await refreshProviders(projectId);
    } catch (error) {
      setProvidersError(messageFor(error, 'Unable to disconnect provider.'));
    } finally {
      setActionPending(null);
    }
  }

  async function handleValidate(provider: string): Promise<void> {
    if (projectId === null || actionPending !== null) return;
    setActionPending(`validate:${provider}`);
    try {
      await validateProvider(projectId, provider);
      await refreshProviders(projectId);
    } catch (error) {
      setProvidersError(messageFor(error, 'Unable to validate provider.'));
    } finally {
      setActionPending(null);
    }
  }

  if (projectId === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        Select a project first.
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      {providersLoading && (
        <Typography variant="body2" color="text.secondary">
          Loading provider status…
        </Typography>
      )}
      {providersError !== null && <ErrorState message={providersError} />}

      {!providersLoading &&
        KNOWN_PROVIDERS.map((provider) => {
          const status = statusFor(providers, provider);
          return (
            <Stack key={provider} spacing={1} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" sx={{ textTransform: 'capitalize', fontWeight: 600 }}>
                  {provider}
                </Typography>
                <Chip size="small" label={status} color={STATUS_COLOR[status] ?? 'default'} />
              </Stack>

              {status === 'connected' || status === 'invalid' ? (
                <Stack direction="row" spacing={1}>
                  <Button size="small" color="error" variant="outlined" onClick={() => void handleDisconnect(provider)} disabled={actionPending !== null}>
                    {actionPending === `disconnect:${provider}` ? 'Removing…' : 'Remove'}
                  </Button>
                  <Button size="small" variant="outlined" onClick={() => void handleValidate(provider)} disabled={actionPending !== null}>
                    {actionPending === `validate:${provider}` ? 'Checking…' : 'Re-check'}
                  </Button>
                </Stack>
              ) : (
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  <TextField
                    id={`${apiKeyFieldIdBase}-${provider}`}
                    size="small"
                    label={CONNECTION_FIELD[provider].label}
                    type={CONNECTION_FIELD[provider].inputType}
                    autoComplete="off"
                    value={apiKeyInputs[provider] ?? CONNECTION_FIELD[provider].defaultValue ?? ''}
                    onChange={(event) => setApiKeyInputs((prev) => ({ ...prev, [provider]: event.target.value }))}
                    placeholder={CONNECTION_FIELD[provider].placeholder}
                    disabled={connectingProvider === provider}
                    sx={{ minWidth: 260 }}
                  />
                  <Button
                    variant="contained"
                    onClick={() => void handleConnect(provider)}
                    disabled={
                      connectingProvider === provider ||
                      (apiKeyInputs[provider] ?? CONNECTION_FIELD[provider].defaultValue ?? '').trim().length === 0
                    }
                  >
                    {connectingProvider === provider ? 'Connecting…' : 'Connect'}
                  </Button>
                  {connectErrors[provider] !== undefined && connectErrors[provider].length > 0 && (
                    <ErrorState message={connectErrors[provider]} />
                  )}
                </Stack>
              )}
            </Stack>
          );
        })}
    </Stack>
  );
}
