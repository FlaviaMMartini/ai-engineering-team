import type Database from 'better-sqlite3';
import type { ProjectId, Repository, RepositoryId } from '@aet/domain';
import { translateSqliteError } from '../errors.js';

export interface RepositoryRow {
  id: string;
  project_id: string;
  name: string;
  local_path: string;
  default_branch: string;
  remote_url: string | null;
  created_at: string;
}

export function repositoryToRow(repository: Repository): RepositoryRow {
  return {
    id: repository.id,
    project_id: repository.projectId,
    name: repository.name,
    local_path: repository.localPath,
    default_branch: repository.defaultBranch,
    remote_url: repository.remoteUrl,
    created_at: repository.createdAt
  };
}

export function rowToRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    localPath: row.local_path,
    defaultBranch: row.default_branch,
    remoteUrl: row.remote_url,
    createdAt: row.created_at
  };
}

/**
 * A project's registered local repositories (Phase 21: repository
 * selection) — either pointed at an existing folder the user validated, or
 * one this application initialized from scratch for a brand-new task (see
 * git-integration's `initializeNewRepository`). No update()/delete(): like
 * ProjectRepository, editing/removing a registered repository is out of
 * scope here.
 */
export interface RepositoryRepository {
  create(repository: Repository): void;
  findById(id: RepositoryId): Repository | null;
  findByProject(projectId: ProjectId): readonly Repository[];
}

const INSERT_SQL = `
  INSERT INTO repositories (id, project_id, name, local_path, default_branch, remote_url, created_at)
  VALUES (@id, @project_id, @name, @local_path, @default_branch, @remote_url, @created_at)
`;

export class SqliteRepositoryRepository implements RepositoryRepository {
  constructor(private readonly db: Database.Database) {}

  create(repository: Repository): void {
    try {
      this.db.prepare<RepositoryRow>(INSERT_SQL).run(repositoryToRow(repository));
    } catch (error) {
      translateSqliteError(error, 'Repository', repository.id);
    }
  }

  findById(id: RepositoryId): Repository | null {
    const row = this.db.prepare<[RepositoryId], RepositoryRow>('SELECT * FROM repositories WHERE id = ?').get(id);
    return row === undefined ? null : rowToRepository(row);
  }

  findByProject(projectId: ProjectId): readonly Repository[] {
    const rows = this.db
      .prepare<[ProjectId], RepositoryRow>('SELECT * FROM repositories WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId);
    return rows.map(rowToRepository);
  }
}
