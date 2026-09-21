import type { ProjectId, ProjectProviderConfiguration } from '@aet/domain';
import type { CredentialStore, Persistence } from '@aet/persistence';
import type { LLMProvider } from '@aet/providers';

/** Only what credential management actually touches — never the whole `Persistence` surface (never agentExecutions/llmRequests/workflowExecutions/etc.). */
export type CredentialManagementPersistence = Pick<Persistence, 'projects' | 'projectProviderConfigurations' | 'transaction'>;

/**
 * Builds a throwaway `LLMProvider` bound to exactly one candidate API key,
 * used only to call `validateCredential()` before that key is ever
 * encrypted or persisted (connect/validate flows) — never used to make a
 * real generation call. Supplied by the composition root, which is the
 * only place allowed to know which concrete adapter backs which
 * `ProviderName` — this package never imports `@aet/providers`' Anthropic
 * adapter directly and never branches on `provider === 'anthropic'`.
 */
export type CreateProviderForValidation = (provider: string, apiKey: string) => LLMProvider;

export interface CredentialManagementDependencies {
  persistence: CredentialManagementPersistence;
  credentialStore: CredentialStore;
  createProviderForValidation: CreateProviderForValidation;
}

export interface ConnectProviderCredentialInput {
  projectId: ProjectId;
  provider: string;
  apiKey: string;
}

export interface ProjectProviderInput {
  projectId: ProjectId;
  provider: string;
}

export type { ProjectProviderConfiguration };
