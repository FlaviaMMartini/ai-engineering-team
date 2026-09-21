import Anthropic from '@anthropic-ai/sdk';
import type { CredentialProvider } from '../types.js';

export interface AnthropicClientConfig {
  credentialProvider: CredentialProvider;
  /** Override for a self-hosted gateway or test double; defaults to Anthropic's own base URL. */
  baseUrl?: string;
}

/**
 * `maxRetries` is forced to 0. The SDK defaults to 2 automatic retries on
 * network/5xx errors — left alone, that would silently violate this
 * package's "no automatic retry" rule (retry decisions belong entirely to
 * the orchestration layer). The API key is resolved fresh on every call
 * (not cached at provider-construction time) so a future rotating
 * CredentialProvider works without any change here.
 */
export async function createAnthropicClient(config: AnthropicClientConfig): Promise<Anthropic> {
  const apiKey = await config.credentialProvider.getApiKey();
  return new Anthropic({
    apiKey,
    baseURL: config.baseUrl,
    maxRetries: 0
  });
}
