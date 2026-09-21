import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM via node:crypto only — no third-party crypto library, no
 * invented scheme. GCM is an authenticated mode: `decryptSecret` throws if
 * the ciphertext/authTag were tampered with or the wrong key is used,
 * rather than silently returning garbage.
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
/** 96-bit nonce — the size GCM is defined/optimized for; never reused for the same key by construction (see encryptSecret). */
const IV_LENGTH_BYTES = 12;

/** Bumped only if the encryption scheme itself ever changes (e.g. a KDF, a different cipher) — lets old rows stay decryptable during a migration. */
export const CURRENT_ENCRYPTION_VERSION = 1;

export interface EncryptedSecret {
  /** base64 */
  ciphertext: string;
  /** base64 */
  iv: string;
  /** base64 */
  authTag: string;
  encryptionVersion: number;
}

/**
 * Parses the master key from its external representation (see
 * `CREDENTIAL_ENCRYPTION_KEY`) into the exact byte length AES-256 requires.
 * Never derives a key from anything else (a project id, an API key, a
 * fixed test string baked into this module) — the caller supplies it,
 * sourced from server configuration only.
 */
export function parseMasterKey(rawKey: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(rawKey, 'hex');
  } catch (error) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY could not be parsed as a hex string', { cause: error });
  }
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes (${KEY_LENGTH_BYTES * 2} hex characters); got ${key.length} byte(s)`
    );
  }
  return key;
}

/** A fresh random IV every call — the reason the same plaintext never produces the same ciphertext twice. */
export function encryptSecret(plaintext: string, masterKey: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    encryptionVersion: CURRENT_ENCRYPTION_VERSION
  };
}

/** Throws (never returns a wrong/garbage plaintext) if the auth tag doesn't verify — a tampered ciphertext or the wrong key. */
export function decryptSecret(encrypted: EncryptedSecret, masterKey: Buffer): string {
  if (encrypted.encryptionVersion !== CURRENT_ENCRYPTION_VERSION) {
    throw new Error(`Unsupported credential encryption version: ${encrypted.encryptionVersion}`);
  }

  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
