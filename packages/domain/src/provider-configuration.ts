import type { CredentialId, ProjectId, ProviderConfigurationId } from './ids.js';

/**
 * Phase 19 (BYOK) + Phase 20.5/22 (free-tier provider). Started as Ollama
 * (a local runtime, brought forward from the original 0.4 roadmap slot);
 * replaced with Gemini after live testing on modest hardware (no dedicated
 * GPU) showed a 7B local model frequently couldn't complete real tasks —
 * malformed JSON output, requesting nonexistent files, minutes-long
 * generations that starved the rest of the app for CPU. Google's
 * Generative Language API offers a genuine free tier with no local
 * resource cost. Adding "openai" later is meant to be the only domain-level
 * change a future paid adapter needs — this list is the single source of
 * truth application-wide, never duplicated as a hardcoded string elsewhere.
 */
export type ProviderName = 'anthropic' | 'gemini';

export const SUPPORTED_PROVIDER_NAMES: readonly ProviderName[] = ['anthropic', 'gemini'];

export function isSupportedProviderName(value: string): value is ProviderName {
  return (SUPPORTED_PROVIDER_NAMES as readonly string[]).includes(value);
}

export type ProviderConnectionStatus = 'connected' | 'not_configured' | 'invalid';

/**
 * An opaque pointer to a secret held by the credential infrastructure
 * (@aet/persistence's CredentialStore). Carries no cryptographic material
 * and no plaintext — resolving it to an actual secret is an infrastructure
 * operation, never a domain one.
 */
export interface CredentialReference {
  id: CredentialId;
}

/**
 * Non-secret configuration of one provider for one project. This is the
 * whole point of the BYOK boundary: a project knows THAT a provider is
 * connected and via which opaque credential reference, never the secret
 * itself. Never add an `apiKey`/`secret` field to this type.
 */
export interface ProjectProviderConfiguration {
  id: ProviderConfigurationId;
  projectId: ProjectId;
  provider: ProviderName;
  status: ProviderConnectionStatus;
  /** Null exactly when status is 'not_configured'. */
  credentialReference: CredentialReference | null;
  createdAt: string;
  updatedAt: string;
}
