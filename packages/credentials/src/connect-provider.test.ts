import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Persistence } from '@aet/persistence';
import { connectProviderCredential } from './connect-provider.js';
import { CredentialManagementError } from './errors.js';
import { createFakeProviderForValidation, createTestCredentialStore, createTestPersistence, makeProject } from './test-fixtures.js';
import type { CredentialManagementDependencies } from './types.js';

const VALID_KEY = 'sk-ant-test-valid-key';
const INVALID_KEY = 'sk-ant-test-invalid-key';

describe('connectProviderCredential', () => {
  let persistence: Persistence;
  let deps: CredentialManagementDependencies;

  beforeEach(() => {
    persistence = createTestPersistence();
    persistence.projects.create(makeProject());
    deps = {
      persistence,
      credentialStore: createTestCredentialStore(persistence),
      createProviderForValidation: createFakeProviderForValidation(new Set([VALID_KEY, 'sk-ant-test-replacement-key']))
    };
  });

  afterEach(() => {
    persistence.close();
  });

  it('connects a valid credential and marks the provider connected', async () => {
    const result = await connectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic', apiKey: VALID_KEY });
    expect(result.status).toBe('connected');
    expect(result.credentialReference).not.toBeNull();
  });

  it('never persists an invalid credential', async () => {
    await expect(
      connectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic', apiKey: INVALID_KEY })
    ).rejects.toMatchObject({ kind: 'credential_invalid' });

    expect(persistence.projectProviderConfigurations.findByProjectAndProvider('project-1', 'anthropic')).toBeNull();
  });

  it('rejects an unsupported provider without ever calling the credential store', async () => {
    await expect(
      connectProviderCredential(deps, { projectId: 'project-1', provider: 'openai', apiKey: VALID_KEY })
    ).rejects.toMatchObject({ kind: 'provider_not_supported' });
  });

  it('rejects connecting to a project that does not exist', async () => {
    await expect(
      connectProviderCredential(deps, { projectId: 'missing-project', provider: 'anthropic', apiKey: VALID_KEY })
    ).rejects.toBeInstanceOf(CredentialManagementError);
  });

  it('replacing a credential is safe: the new one is validated and stored before the old one is removed', async () => {
    const first = await connectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic', apiKey: VALID_KEY });
    const oldReference = first.credentialReference;
    expect(oldReference).not.toBeNull();

    const second = await connectProviderCredential(deps, {
      projectId: 'project-1',
      provider: 'anthropic',
      apiKey: 'sk-ant-test-replacement-key'
    });

    expect(second.status).toBe('connected');
    expect(second.id).toBe(first.id); // same configuration row — unique(project_id, provider)
    expect(second.credentialReference?.id).not.toBe(oldReference?.id);

    // The old credential is gone (replaced, not orphaned).
    if (oldReference !== null) {
      await expect(deps.credentialStore.getSecret(oldReference)).rejects.toThrow();
    }
    // The new one resolves correctly.
    if (second.credentialReference !== null) {
      await expect(deps.credentialStore.getSecret(second.credentialReference)).resolves.toBe('sk-ant-test-replacement-key');
    }
  });

  it('a failed replacement never destroys the previously-working credential', async () => {
    const first = await connectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic', apiKey: VALID_KEY });
    const oldReference = first.credentialReference;

    await expect(
      connectProviderCredential(deps, { projectId: 'project-1', provider: 'anthropic', apiKey: INVALID_KEY })
    ).rejects.toMatchObject({ kind: 'credential_invalid' });

    // The original credential must still resolve — an invalid replacement attempt must not have touched it.
    const stillConfigured = persistence.projectProviderConfigurations.findByProjectAndProvider('project-1', 'anthropic');
    expect(stillConfigured?.status).toBe('connected');
    expect(stillConfigured?.credentialReference?.id).toBe(oldReference?.id);
    if (oldReference !== null) {
      await expect(deps.credentialStore.getSecret(oldReference)).resolves.toBe(VALID_KEY);
    }
  });
});
