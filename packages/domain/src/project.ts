import type { ProjectId, RepositoryId } from './ids.js';

export interface Project {
  id: ProjectId;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface Repository {
  id: RepositoryId;
  projectId: ProjectId;
  name: string;
  /** Absolute path to a local working copy. MVP works against local repos only. */
  localPath: string;
  defaultBranch: string;
  remoteUrl: string | null;
  createdAt: string;
}
