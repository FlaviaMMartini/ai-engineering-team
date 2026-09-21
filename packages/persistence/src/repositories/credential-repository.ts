import type Database from 'better-sqlite3';
import type { CredentialId } from '@aet/domain';
import { NotFoundError, translateSqliteError } from '../errors.js';

/**
 * The raw encrypted row — ciphertext/iv/authTag/version only, exactly what
 * `@aet/domain`'s `CredentialReference` deliberately does not expose.
 * Never returns or accepts plaintext; encryption/decryption itself lives
 * one layer up, in `../credential-store.ts`, which is the only caller of
 * `findById` that ever sees this row shape.
 */
export interface CredentialRecord {
  id: CredentialId;
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialRow {
  id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  encryption_version: number;
  created_at: string;
  updated_at: string;
}

export function credentialToRow(record: CredentialRecord): CredentialRow {
  return {
    id: record.id,
    ciphertext: record.ciphertext,
    iv: record.iv,
    auth_tag: record.authTag,
    encryption_version: record.encryptionVersion,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

export function rowToCredential(row: CredentialRow): CredentialRecord {
  return {
    id: row.id,
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    encryptionVersion: row.encryption_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Deliberately minimal: create/findById/delete only — no update() (a
 * credential is replaced by creating a new row and deleting the old one,
 * never mutated in place; see @aet/credentials' connect flow) and no
 * list-all (nothing outside this package should ever enumerate raw
 * encrypted rows).
 */
export interface CredentialRepository {
  create(record: CredentialRecord): void;
  findById(id: CredentialId): CredentialRecord | null;
  delete(id: CredentialId): void;
}

const INSERT_SQL = `
  INSERT INTO credentials (id, ciphertext, iv, auth_tag, encryption_version, created_at, updated_at)
  VALUES (@id, @ciphertext, @iv, @auth_tag, @encryption_version, @created_at, @updated_at)
`;

export class SqliteCredentialRepository implements CredentialRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: CredentialRecord): void {
    try {
      this.db.prepare<CredentialRow>(INSERT_SQL).run(credentialToRow(record));
    } catch (error) {
      translateSqliteError(error, 'Credential', record.id);
    }
  }

  findById(id: CredentialId): CredentialRecord | null {
    const row = this.db.prepare<[CredentialId], CredentialRow>('SELECT * FROM credentials WHERE id = ?').get(id);
    return row === undefined ? null : rowToCredential(row);
  }

  delete(id: CredentialId): void {
    const result = this.db.prepare<[CredentialId]>('DELETE FROM credentials WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Credential', id);
    }
  }
}
