import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCredentialStore, type CredentialStore } from './credential-store.js';
import { createPersistence, type Persistence } from './persistence.js';
import { NotFoundError } from './errors.js';

/** Synthetic, obviously-fake test key — never a real secret. */
const TEST_MASTER_KEY_HEX = 'ab'.repeat(32);

describe('createCredentialStore', () => {
  let persistence: Persistence;
  let credentialStore: CredentialStore;

  beforeEach(() => {
    persistence = createPersistence(':memory:');
    credentialStore = createCredentialStore({ credentialRepository: persistence.credentials, masterKey: TEST_MASTER_KEY_HEX });
  });

  afterEach(() => {
    persistence.close();
  });

  it('fails fast on a malformed master key rather than deferring the failure to first use', () => {
    expect(() => createCredentialStore({ credentialRepository: persistence.credentials, masterKey: 'not-hex-and-too-short' })).toThrow();
  });

  it('round-trips a secret through create() and getSecret()', async () => {
    const secret = 'sk-ant-test-synthetic-credential-store-key';
    const reference = await credentialStore.create(secret);
    await expect(credentialStore.getSecret(reference)).resolves.toBe(secret);
  });

  it('never stores the plaintext secret in the underlying repository row', async () => {
    const secret = 'sk-ant-plaintext-should-never-appear-in-storage';
    const reference = await credentialStore.create(secret);

    const rawRecord = persistence.credentials.findById(reference.id);
    expect(rawRecord).not.toBeNull();
    expect(rawRecord?.ciphertext).not.toBe(secret);
    expect(rawRecord?.ciphertext.includes(secret)).toBe(false);
    // The raw row exposes only ciphertext/iv/authTag/version — no plaintext-shaped field exists on it at all.
    expect(Object.keys(rawRecord ?? {}).sort()).toEqual(['authTag', 'ciphertext', 'createdAt', 'encryptionVersion', 'id', 'iv', 'updatedAt'].sort());
  });

  it('delete() removes the credential so a later getSecret() fails', async () => {
    const reference = await credentialStore.create('sk-ant-to-be-deleted');
    await credentialStore.delete(reference);
    await expect(credentialStore.getSecret(reference)).rejects.toThrow(NotFoundError);
  });

  it('getSecret() fails for a reference that was never created', async () => {
    await expect(credentialStore.getSecret({ id: 'never-created' })).rejects.toThrow(NotFoundError);
  });
});
