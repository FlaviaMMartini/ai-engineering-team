import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { listProjectTasks } from '../api/projects.js';
import type { TaskDto } from '../types/api.js';

const POLL_INTERVAL_MS = 2500;

export interface UseProjectTasksResult {
  tasks: readonly TaskDto[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches GET /projects/:projectId/tasks and keeps polling at a fixed
 * interval for as long as a project is selected — unlike
 * useExecutionDetails, there is no terminal state here: the board must keep
 * reflecting every task's state (including new tasks created after the
 * first load), not just one execution's lifecycle. Cleans itself up on
 * unmount and on `projectId` changing.
 */
export function useProjectTasks(projectId: string | null): UseProjectTasksResult {
  const [tasks, setTasks] = useState<readonly TaskDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTasks([]);
    setError(null);

    if (projectId === null) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let isFirstFetch = true;

    // `loading` only ever reflects "no data on screen yet" — it's set once, before the very
    // first fetch, and never again. A background poll tick that toggled it on every cycle
    // (even when nothing changed) made the board flicker between its "empty" state and the
    // real board every 2.5s, since TaskBoard renders the empty state only while `!loading`.
    async function poll(id: string): Promise<void> {
      if (isFirstFetch) setLoading(true);
      try {
        const result = await listProjectTasks(id);
        if (cancelled) return;
        setTasks(result.tasks);
        setError(null);
        setLoading(false);
        isFirstFetch = false;
        timeoutId = setTimeout(() => {
          void poll(id);
        }, POLL_INTERVAL_MS);
      } catch (pollError) {
        if (cancelled) return;
        setLoading(false);
        setError(pollError instanceof ApiError ? pollError.message : 'Unable to load tasks.');
      }
    }

    void poll(projectId);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [projectId]);

  return { tasks, loading, error };
}
