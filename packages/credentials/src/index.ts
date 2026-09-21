export { connectProviderCredential } from './connect-provider.js';
export { disconnectProviderCredential } from './disconnect-provider.js';
export { validateProviderCredential } from './validate-provider.js';
export { listProviderConfigurations } from './list-providers.js';
export { createProjectCredentialProvider } from './resolve-credential.js';
export type { ProjectCredentialProviderDependencies } from './resolve-credential.js';

export { CredentialManagementError } from './errors.js';
export type { CredentialManagementErrorKind } from './errors.js';

export type {
  ConnectProviderCredentialInput,
  CreateProviderForValidation,
  CredentialManagementDependencies,
  CredentialManagementPersistence,
  ProjectProviderInput
} from './types.js';
