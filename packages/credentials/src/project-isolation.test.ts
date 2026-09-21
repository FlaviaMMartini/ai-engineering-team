import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Persistence } from '@aet/persistence';
import { connectProviderCredential } from './connect-provider.js';
import { createProjectCredentialProvider } from './resolve-credential.js';
import { createFakeProviderForValidation, createTestCredentialStore, createTestPersistence, makeProject } from './test-fixtures.js';
import type { CredentialManagementDependencies } from './types.js';

const PROJECT_A_KEY = 'sk-ant-test-project-a-key';
const PROJECT_B_KEY = 'sk-ant-test-project-b-key';

/**
 * The single most important guarantee this phase introduces: a credential
 * belongs to exactly one project. Resolving "the" Anthropic credential for
 * project A must never, under any circumstance, return project B's key —
 * even though both configurations live in the same `project_provider_configurations`
 * table and both credentials live in the same `credentials` table.
 */
describe('project isolation', () => {
  let persistence: Persistence;
  let deps: CredentialManagementDependencies;

  beforeEach(() => {
    persistence = createTestPersistence();
    persistence.projects.create(makeProject({ id: 'project-a', name: 'Project A' }));
    persistence.projects.create(makeProject({ id: 'project-b', name: 'Project B' }));
    deps = {
      persistence,
      credentialStore: createTestCredentialStore(persistence),
      createProviderForValidation: createFakeProviderForValidation(new Set([PROJECT_A_KEY, PROJECT_B_KEY]))
    };
  });

  afterEach(() => {
    persistence.close();
  });

  it('each project resolves only its own connected credential at execution time', async () => {
    await connectProviderCredential(deps, { projectId: 'project-a', provider: 'anthropic', apiKey: PROJECT_A_KEY });
    await connectProviderCredential(deps, { projectId: 'project-b', provider: 'anthropic', apiKey: PROJECT_B_KEY });

    const projectACredentialProvider = createProjectCredentialProvider({
      projectId: 'project-a',
      provider: 'anthropic',
      persistence,
      credentialStore: deps.credentialStore
    });
    const projectBCredentialProvider = createProjectCredentialProvider({
      projectId: 'project-b',
      provider: 'anthropic',
      persistence,
      credentialStore: deps.credentialStore
    });

    await expect(projectACredentialProvider.getApiKey()).resolves.toBe(PROJECT_A_KEY);
    await expect(projectBCredentialProvider.getApiKey()).resolves.toBe(PROJECT_B_KEY);
  });

  it('a project with no connected credential cannot obtain another project\'s credential, even with no fallback configured', async () => {
    await connectProviderCredential(deps, { projectId: 'project-a', provider: 'anthropic', apiKey: PROJECT_A_KEY });
    // project-b never connects anything.

    const projectBCredentialProvider = createProjectCredentialProvider({
      projectId: 'project-b',
      provider: 'anthropic',
      persistence,
      credentialStore: deps.credentialStore
    });

    await expect(projectBCredentialProvider.getApiKey()).rejects.toMatchObject({ kind: 'credential_not_configured' });
  });

  it('disconnecting project A does not affect project B\'s credential', async () => {
    await connectProviderCredential(deps, { projectId: 'project-a', provider: 'anthropic', apiKey: PROJECT_A_KEY });
    await connectProviderCredential(deps, { projectId: 'project-b', provider: 'anthropic', apiKey: PROJECT_B_KEY });

    persistence.projectProviderConfigurations.update({
      ...persistence.projectProviderConfigurations.findByProjectAndProvider('project-a', 'anthropic')!,
      status: 'not_configured',
      credentialReference: null
    });

    const projectBCredentialProvider = createProjectCredentialProvider({
      projectId: 'project-b',
      provider: 'anthropic',
      persistence,
      credentialStore: deps.credentialStore
    });
    await expect(projectBCredentialProvider.getApiKey()).resolves.toBe(PROJECT_B_KEY);
  });

  it('a dev-bootstrap fallback key is used only when the project has no connected credential of its own', async () => {
    await connectProviderCredential(deps, { projectId: 'project-a', provider: 'anthropic', apiKey: PROJECT_A_KEY });

    const projectAWithFallback = createProjectCredentialProvider({
      projectId: 'project-a',
      provider: 'anthropic',
      persistence,
      credentialStore: deps.credentialStore,
      fallbackApiKey: 'sk-ant-test-dev-bootstrap-fallback'
    });
    // Project A's own credential takes priority over the fallback.
    await expect(projectAWithFallback.getApiKey()).resolves.toBe(PROJECT_A_KEY);

    const projectBWithFallback = createProjectCredentialProvider({
      projectId: 'project-b',
      provider: 'anthropic',
      persistence,
      credentialStore: deps.credentialStore,
      fallbackApiKey: 'sk-ant-test-dev-bootstrap-fallback'
    });
    // Project B has no credential of its own, so the fallback is used.
    await expect(projectBWithFallback.getApiKey()).resolves.toBe('sk-ant-test-dev-bootstrap-fallback');
  });
});
