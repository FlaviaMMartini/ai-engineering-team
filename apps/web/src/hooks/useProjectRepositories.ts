import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { listRepositories } from '../api/projects.js';
import type { RepositoryDto } from '../types/api.js';

export interface UseProjectRepositoriesResult {
  repositories: readonly RepositoryDto[];
  loading: boolean;
  error: string | null;
  /** Re-fetches once, immediately — for "the user just registered a repository, show it now." */
  refresh: () => void;
}

/**
 * Fetches GET /projects/:projectId/repositories once per `projectId` change.
 * No polling loop, unlike useProjectTasks — a project's registered
 * repositories only ever change through this same UI's own register action
 * (see ProjectRepositories.tsx), which already calls `refresh()` itself.
 */
export function useProjectRepositories(projectId: string | null): UseProjectRepositoriesResult {
  const [repositories, setRepositories] = useState<readonly RepositoryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    try {
      const result = await listRepositories(id);
      setRepositories(result.repositories);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof ApiError ? fetchError.message : 'Unable to load repositories.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setRepositories([]);
    setError(null);
    if (projectId === null) {
      setLoading(false);
      return;
    }
    void fetchOnce(projectId);
  }, [projectId, fetchOnce]);

  const refresh = useCallback(() => {
    if (projectId === null) return;
    void fetchOnce(projectId);
  }, [projectId, fetchOnce]);

  return { repositories, loading, error, refresh };
}
