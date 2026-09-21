import type { Project } from '@aet/domain';
import { createCredentialStore, createPersistence, type CredentialStore, type Persistence } from '@aet/persistence';
import type { LLMProvider } from '@aet/providers';
import type { CreateProviderForValidation } from './types.js';

/** Synthetic, obviously-fake test key — never a real secret, never reused outside tests. */
export const TEST_MASTER_KEY_HEX = 'cd'.repeat(32);

export function makeProject(overrides: Partial<Project> = {}): Project {
  return { id: 'project-1', name: 'Test Project', description: null, createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
}

export function createTestPersistence(): Persistence {
  return createPersistence(':memory:');
}

export function createTestCredentialStore(persistence: Persistence): CredentialStore {
  return createCredentialStore({ credentialRepository: persistence.credentials, masterKey: TEST_MASTER_KEY_HEX });
}

/**
 * A `createProviderForValidation` double whose `validateCredential()`
 * outcome is controlled by whether `apiKey` is in `validKeys` — never makes
 * a real network call. Every key used across this package's tests is an
 * obviously-synthetic string (e.g. `sk-ant-test-project-a`), never a real
 * API key shape or a real secret.
 */
export function createFakeProviderForValidation(validKeys: ReadonlySet<string>): CreateProviderForValidation {
  return (_provider: string, apiKey: string): LLMProvider => ({
    provider: 'anthropic',
    async generate() {
      throw new Error('generate() must never be called by credential management tests');
    },
    async validateCredential(): Promise<void> {
      if (!validKeys.has(apiKey)) {
        throw new Error('synthetic invalid credential');
      }
    }
  });
}
