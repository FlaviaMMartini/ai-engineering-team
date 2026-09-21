import type Database from 'better-sqlite3';
import type { Project, ProjectId } from '@aet/domain';
import { translateSqliteError } from '../errors.js';

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export function projectToRow(project: Project): ProjectRow {
  return { id: project.id, name: project.name, description: project.description, created_at: project.createdAt };
}

export function rowToProject(row: ProjectRow): Project {
  return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at };
}

/**
 * Minimal — exactly what Phase 19's BYOK flow needs (a project must exist
 * so a provider configuration can reference it) and no more. No
 * update()/delete(): editing/removing a project is out of scope here.
 */
export interface ProjectRepository {
  create(project: Project): void;
  findById(id: ProjectId): Project | null;
  list(): readonly Project[];
}

const INSERT_SQL = `INSERT INTO projects (id, name, description, created_at) VALUES (@id, @name, @description, @created_at)`;

export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: Database.Database) {}

  create(project: Project): void {
    try {
      this.db.prepare<ProjectRow>(INSERT_SQL).run(projectToRow(project));
    } catch (error) {
      translateSqliteError(error, 'Project', project.id);
    }
  }

  findById(id: ProjectId): Project | null {
    const row = this.db.prepare<[ProjectId], ProjectRow>('SELECT * FROM projects WHERE id = ?').get(id);
    return row === undefined ? null : rowToProject(row);
  }

  list(): readonly Project[] {
    const rows = this.db.prepare<[], ProjectRow>('SELECT * FROM projects ORDER BY created_at ASC').all();
    return rows.map(rowToProject);
  }
}
