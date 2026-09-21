import type Database from 'better-sqlite3';
import type { ProjectId, ProjectProviderConfiguration, ProviderConnectionStatus, ProviderName } from '@aet/domain';
import { translateSqliteError } from '../errors.js';

export interface ProjectProviderConfigurationRow {
  id: string;
  project_id: string;
  provider: string;
  status: string;
  credential_id: string | null;
  created_at: string;
  updated_at: string;
}

export function projectProviderConfigurationToRow(config: ProjectProviderConfiguration): ProjectProviderConfigurationRow {
  return {
    id: config.id,
    project_id: config.projectId,
    provider: config.provider,
    status: config.status,
    credential_id: config.credentialReference?.id ?? null,
    created_at: config.createdAt,
    updated_at: config.updatedAt
  };
}

export function rowToProjectProviderConfiguration(row: ProjectProviderConfigurationRow): ProjectProviderConfiguration {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider as ProviderName,
    status: row.status as ProviderConnectionStatus,
    credentialReference: row.credential_id === null ? null : { id: row.credential_id },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * `unique(project_id, provider)` (enforced at the schema level) means a
 * project has at most one configuration row per provider ever — connecting
 * a provider again is always `update()`, never a second `create()`.
 */
export interface ProjectProviderConfigurationRepository {
  create(config: ProjectProviderConfiguration): void;
  update(config: ProjectProviderConfiguration): void;
  findByProjectAndProvider(projectId: ProjectId, provider: ProviderName): ProjectProviderConfiguration | null;
  findByProjectId(projectId: ProjectId): readonly ProjectProviderConfiguration[];
}

const INSERT_SQL = `
  INSERT INTO project_provider_configurations (id, project_id, provider, status, credential_id, created_at, updated_at)
  VALUES (@id, @project_id, @provider, @status, @credential_id, @created_at, @updated_at)
`;

const UPDATE_SQL = `
  UPDATE project_provider_configurations
  SET status = @status, credential_id = @credential_id, updated_at = @updated_at
  WHERE id = @id
`;

export class SqliteProjectProviderConfigurationRepository implements ProjectProviderConfigurationRepository {
  constructor(private readonly db: Database.Database) {}

  create(config: ProjectProviderConfiguration): void {
    try {
      this.db.prepare<ProjectProviderConfigurationRow>(INSERT_SQL).run(projectProviderConfigurationToRow(config));
    } catch (error) {
      translateSqliteError(error, 'ProjectProviderConfiguration', config.id);
    }
  }

  update(config: ProjectProviderConfiguration): void {
    this.db
      .prepare<{ id: string; status: string; credential_id: string | null; updated_at: string }>(UPDATE_SQL)
      .run({
        id: config.id,
        status: config.status,
        credential_id: config.credentialReference?.id ?? null,
        updated_at: config.updatedAt
      });
  }

  findByProjectAndProvider(projectId: ProjectId, provider: ProviderName): ProjectProviderConfiguration | null {
    const row = this.db
      .prepare<[ProjectId, ProviderName], ProjectProviderConfigurationRow>(
        'SELECT * FROM project_provider_configurations WHERE project_id = ? AND provider = ?'
      )
      .get(projectId, provider);
    return row === undefined ? null : rowToProjectProviderConfiguration(row);
  }

  findByProjectId(projectId: ProjectId): readonly ProjectProviderConfiguration[] {
    const rows = this.db
      .prepare<[ProjectId], ProjectProviderConfigurationRow>(
        'SELECT * FROM project_provider_configurations WHERE project_id = ? ORDER BY created_at ASC'
      )
      .all(projectId);
    return rows.map(rowToProjectProviderConfiguration);
  }
}
