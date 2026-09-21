import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, parseMasterKey } from './aes-gcm.js';

/** Synthetic, obviously-fake test key — 32 bytes of zeros as hex. Never a real secret, never reused outside this test file. */
const TEST_MASTER_KEY_HEX = '00'.repeat(32);

describe('parseMasterKey', () => {
  it('accepts a 64-character hex string (32 bytes)', () => {
    expect(() => parseMasterKey(TEST_MASTER_KEY_HEX)).not.toThrow();
  });

  it('rejects a key that decodes to fewer than 32 bytes', () => {
    expect(() => parseMasterKey('00'.repeat(16))).toThrow(/32 bytes/);
  });

  it('rejects a key that decodes to more than 32 bytes', () => {
    expect(() => parseMasterKey('00'.repeat(48))).toThrow(/32 bytes/);
  });
});

describe('encryptSecret / decryptSecret', () => {
  const masterKey = parseMasterKey(TEST_MASTER_KEY_HEX);

  it('round-trips: decrypting an encrypted secret returns the original plaintext', () => {
    const plaintext = 'sk-ant-test-synthetic-key-not-real';
    const encrypted = encryptSecret(plaintext, masterKey);
    expect(decryptSecret(encrypted, masterKey)).toBe(plaintext);
  });

  it('produces ciphertext that never contains or equals the plaintext', () => {
    const plaintext = 'sk-ant-another-synthetic-key';
    const encrypted = encryptSecret(plaintext, masterKey);
    expect(encrypted.ciphertext).not.toBe(plaintext);
    expect(encrypted.ciphertext.includes(plaintext)).toBe(false);
    expect(Buffer.from(encrypted.ciphertext, 'base64').toString('utf8')).not.toContain(plaintext);
  });

  it('produces a different ciphertext each time for the same plaintext, thanks to a fresh IV', () => {
    const plaintext = 'sk-ant-same-secret-both-times';
    const first = encryptSecret(plaintext, masterKey);
    const second = encryptSecret(plaintext, masterKey);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    // Both still decrypt to the same original plaintext.
    expect(decryptSecret(first, masterKey)).toBe(plaintext);
    expect(decryptSecret(second, masterKey)).toBe(plaintext);
  });

  it('fails to decrypt when the authentication tag has been tampered with', () => {
    const encrypted = encryptSecret('sk-ant-tamper-tag-test', masterKey);
    const tamperedTag = Buffer.from(encrypted.authTag, 'base64');
    tamperedTag[0] = (tamperedTag[0] ?? 0) ^ 0xff;
    const tampered = { ...encrypted, authTag: tamperedTag.toString('base64') };
    expect(() => decryptSecret(tampered, masterKey)).toThrow();
  });

  it('fails to decrypt when the ciphertext has been tampered with', () => {
    const encrypted = encryptSecret('sk-ant-tamper-ciphertext-test', masterKey);
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
    tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 0xff;
    const tampered = { ...encrypted, ciphertext: tamperedCiphertext.toString('base64') };
    expect(() => decryptSecret(tampered, masterKey)).toThrow();
  });

  it('fails to decrypt with the wrong master key', () => {
    const encrypted = encryptSecret('sk-ant-wrong-key-test', masterKey);
    const wrongKey = parseMasterKey('11'.repeat(32));
    expect(() => decryptSecret(encrypted, wrongKey)).toThrow();
  });

  it('rejects an unsupported encryption version rather than attempting to decrypt it', () => {
    const encrypted = encryptSecret('sk-ant-version-test', masterKey);
    expect(() => decryptSecret({ ...encrypted, encryptionVersion: 999 }, masterKey)).toThrow(/version/);
  });
});
