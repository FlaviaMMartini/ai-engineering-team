import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { getTaskExecution } from '../api/executions.js';
import type { ExecutionDetailsResponseBody } from '../types/api.js';

const POLL_INTERVAL_MS = 2500;

/** Task states past which nothing else will change without a new execution — polling stops here. Mirrors useExecutionDetails.ts's own set. */
const TERMINAL_TASK_STATUSES = new Set(['HUMAN_REVIEW', 'DONE', 'FAILED', 'BLOCKED']);

export interface UseTaskExecutionResult {
  details: ExecutionDetailsResponseBody | null;
  /** True once a 404 confirms this task has never been executed — distinct from `error`, since it isn't a failure, just "nothing to show yet, offer to execute it." */
  notExecuted: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * The Kanban board (TaskBoard.tsx) selects a task by id, not an execution
 * id — a task can be selected before it's ever been executed (fresh out of
 * BACKLOG). This hook polls GET /tasks/:taskId/execution (Phase 14) rather
 * than useExecutionDetails' GET /executions/:executionId/details, so the
 * caller never has to separately track "which execution belongs to this
 * task" itself.
 */
export function useTaskExecution(taskId: string | null): UseTaskExecutionResult {
  const [details, setDetails] = useState<ExecutionDetailsResponseBody | null>(null);
  const [notExecuted, setNotExecuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRequestId = useRef(0);

  useEffect(() => {
    setDetails(null);
    setNotExecuted(false);
    setError(null);

    if (taskId === null) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let isFirstFetch = true;

    // `loading` only ever reflects "no data on screen yet" — set once before the first fetch,
    // never toggled again on later background poll ticks (see useProjectTasks.ts for the same
    // pattern and why: a `loading` that flips on every cycle causes visible UI flicker anywhere
    // it gates what renders).
    async function poll(id: string): Promise<void> {
      if (isFirstFetch) setLoading(true);
      try {
        const result = await getTaskExecution(id);
        if (cancelled) return;
        setDetails(result);
        setNotExecuted(false);
        setError(null);
        setLoading(false);
        isFirstFetch = false;
        if (!TERMINAL_TASK_STATUSES.has(result.task.status)) {
          timeoutId = setTimeout(() => {
            void poll(id);
          }, POLL_INTERVAL_MS);
        }
      } catch (pollError) {
        if (cancelled) return;
        setLoading(false);
        if (pollError instanceof ApiError && pollError.statusCode === 404) {
          setDetails(null);
          setNotExecuted(true);
          setError(null);
          isFirstFetch = false;
          // Keep polling: a 404 here means "no execution yet," not a terminal condition — the
          // task can start executing at any moment (the user clicking Execute, or another
          // client), and this is the only signal that would ever flip `notExecuted` back to
          // false. Stopping here (as an earlier version of this hook did) left the Execution
          // panel frozen on "hasn't been executed yet" for the task's entire run.
          timeoutId = setTimeout(() => {
            void poll(id);
          }, POLL_INTERVAL_MS);
          return;
        }
        setError(pollError instanceof ApiError ? pollError.message : 'Unable to load execution details.');
      }
    }

    void poll(taskId);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [taskId]);

  const refresh = useCallback(() => {
    if (taskId === null) return;
    const requestId = refreshRequestId.current + 1;
    refreshRequestId.current = requestId;

    void (async () => {
      try {
        const result = await getTaskExecution(taskId);
        if (refreshRequestId.current !== requestId) return;
        setDetails(result);
        setNotExecuted(false);
        setError(null);
      } catch (refreshError) {
        if (refreshRequestId.current !== requestId) return;
        if (refreshError instanceof ApiError && refreshError.statusCode === 404) {
          setDetails(null);
          setNotExecuted(true);
          setError(null);
          return;
        }
        setError(refreshError instanceof ApiError ? refreshError.message : 'Unable to load execution details.');
      }
    })();
  }, [taskId]);

  return { details, notExecuted, loading, error, refresh };
}
