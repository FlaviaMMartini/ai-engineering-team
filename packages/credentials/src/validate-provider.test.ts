import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Persistence } from '@aet/persistence';
import { connectProviderCredential } from './connect-provider.js';
import { validateProviderCredential } from './validate-provider.js';
import { createFakeProviderForValidation, createTestCredentialStore, createTestPersistence, makeProject } from './test-fixtures.js';
import type { CredentialManagementDependencies } from './types.js';

const VALID_KEY = 'sk-ant-test-validate-key';

describe('validateProviderCredential', () => {
  let persistence: Persistence;
  let deps: CredentialManagementDependencies;

  beforeEach(() => {
    persistence = createTestPersistence();
    persistence.projects.create(makeProject());
    // Starts as the only accepted key; individual tests mutate this set to flip the outcome.
    deps = {
      persistence,
      credentialStore: createTestCredentialStore(persistence),
      createProviderForValidation: createFakeProviderForValidation(new Set([VALID_KEY]))
    };
  });

  afterEach(() => {
    persistence.close();
  });

  it('re-validating a still-good credential keeps it connected', async () => {
    await connectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic', apiKey: VALID_KEY });
    const result = await validateProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic' });
    expect(result.status).toBe('connected');
  });

  it('marks a credential invalid when the provider now rejects it, without deleting it', async () => {
    const connected = await connectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic', apiKey: VALID_KEY });
    // Simulate the key being revoked on the provider's side: the fake validator now accepts nothing.
    deps.createProviderForValidation = () => ({
      provider: 'anthropic',
      async generate() {
        throw new Error('unused');
      },
      async validateCredential() {
        throw new Error('revoked');
      }
    });

    const result = await validateProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic' });
    expect(result.status).toBe('invalid');
    // The encrypted credential itself is untouched — still resolvable, in case the failure was transient.
    if (connected.credentialReference !== null) {
      await expect(deps.credentialStore.getSecret(connected.credentialReference)).resolves.toBe(VALID_KEY);
    }
  });

  it('throws credential_not_configured when no credential exists to validate', async () => {
    await expect(validateProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic' })).rejects.toMatchObject({
      kind: 'credential_not_configured'
    });
  });
});
