import { randomUUID } from 'node:crypto';
import type { CredentialReference } from '@aet/domain';
import { decryptSecret, encryptSecret, parseMasterKey } from './crypto/aes-gcm.js';
import { NotFoundError } from './errors.js';
import type { CredentialRepository } from './repositories/credential-repository.js';

/**
 * The one place a plaintext secret is ever encrypted or decrypted.
 * `getSecret` is deliberately the most sensitive method in this codebase —
 * see @aet/credentials' doc comments for why nothing above the composition
 * root ever calls it directly except a `CredentialProvider` resolved for
 * exactly one project+provider at LLM-call time. All three methods return
 * Promises so a future non-local store (e.g. a real secrets manager) can
 * implement this same interface without changing any caller.
 */
export interface CredentialStore {
  create(secret: string): Promise<CredentialReference>;
  getSecret(reference: CredentialReference): Promise<string>;
  delete(reference: CredentialReference): Promise<void>;
}

export interface CredentialStoreDependencies {
  credentialRepository: CredentialRepository;
  /** The raw external representation (see `CREDENTIAL_ENCRYPTION_KEY`) — parsed once, here, never re-read from config after construction. */
  masterKey: string;
}

/**
 * `masterKey` is parsed (and validated for length) once at construction —
 * an application that boots with a malformed key fails immediately at
 * startup, not on the first credential operation. Never derives a key from
 * anything else (a project id, an API key, a fixed string) — see
 * `crypto/aes-gcm.ts`'s `parseMasterKey` doc comment.
 */
export function createCredentialStore(deps: CredentialStoreDependencies): CredentialStore {
  const masterKey = parseMasterKey(deps.masterKey);

  return {
    async create(secret: string): Promise<CredentialReference> {
      const encrypted = encryptSecret(secret, masterKey);
      const now = new Date().toISOString();
      const id = randomUUID();
      deps.credentialRepository.create({
        id,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        encryptionVersion: encrypted.encryptionVersion,
        createdAt: now,
        updatedAt: now
      });
      return { id };
    },

    async getSecret(reference: CredentialReference): Promise<string> {
      const record = deps.credentialRepository.findById(reference.id);
      if (record === null) {
        throw new NotFoundError('Credential', reference.id);
      }
      return decryptSecret(
        { ciphertext: record.ciphertext, iv: record.iv, authTag: record.authTag, encryptionVersion: record.encryptionVersion },
        masterKey
      );
    },

    async delete(reference: CredentialReference): Promise<void> {
      deps.credentialRepository.delete(reference.id);
    }
  };
}
