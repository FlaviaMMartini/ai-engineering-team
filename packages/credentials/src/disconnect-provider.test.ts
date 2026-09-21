import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Persistence } from '@aet/persistence';
import { connectProviderCredential } from './connect-provider.js';
import { disconnectProviderCredential } from './disconnect-provider.js';
import { createFakeProviderForValidation, createTestCredentialStore, createTestPersistence, makeProject } from './test-fixtures.js';
import type { CredentialManagementDependencies } from './types.js';

const VALID_KEY = 'sk-ant-test-disconnect-key';

describe('disconnectProviderCredential', () => {
  let persistence: Persistence;
  let deps: CredentialManagementDependencies;

  beforeEach(() => {
    persistence = createTestPersistence();
    persistence.projects.create(makeProject());
    deps = {
      persistence,
      credentialStore: createTestCredentialStore(persistence),
      createProviderForValidation: createFakeProviderForValidation(new Set([VALID_KEY]))
    };
  });

  afterEach(() => {
    persistence.close();
  });

  it('removes a connected credential and reports not_configured', async () => {
    const connected = await connectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic', apiKey: VALID_KEY });
    const credentialReference = connected.credentialReference;

    const result = await disconnectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic' });

    expect(result.status).toBe('not_configured');
    expect(result.credentialReference).toBeNull();
    if (credentialReference !== null) {
      await expect(deps.credentialStore.getSecret(credentialReference)).rejects.toThrow();
    }
  });

  it('is idempotent: disconnecting an already-disconnected provider succeeds and reports not_configured', async () => {
    const result = await disconnectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic' });
    expect(result.status).toBe('not_configured');
  });
});
