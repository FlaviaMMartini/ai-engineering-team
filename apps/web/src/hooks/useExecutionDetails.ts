import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { getExecutionDetails } from '../api/executions.js';
import type { ExecutionDetailsResponseBody } from '../types/api.js';

const POLL_INTERVAL_MS = 2500;

/** Task states past which nothing else will change without a new execution — polling stops here. */
const TERMINAL_TASK_STATUSES = new Set(['HUMAN_REVIEW', 'DONE', 'FAILED', 'BLOCKED']);

export interface UseExecutionDetailsResult {
  details: ExecutionDetailsResponseBody | null;
  loading: boolean;
  error: string | null;
  /** Fetches once, immediately, outside the poll schedule — for "the user just took an action, show its result now" (e.g. after submitting a human review decision). Does not resume interval polling. */
  refresh: () => void;
}

/**
 * Fetches GET /executions/:executionId/details once, then re-polls at a
 * fixed interval only while the task's status is non-terminal. No generic
 * polling framework — this is the one, minimal mechanism the phase asks
 * for. Cleans itself up on unmount, on `executionId` changing, and once a
 * terminal status is reached.
 */
export function useExecutionDetails(executionId: string | null): UseExecutionDetailsResult {
  const [details, setDetails] = useState<ExecutionDetailsResponseBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRequestId = useRef(0);

  useEffect(() => {
    setDetails(null);
    setError(null);

    if (executionId === null) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function poll(id: string): Promise<void> {
      setLoading(true);
      try {
        const result = await getExecutionDetails(id);
        if (cancelled) return;
        setDetails(result);
        setError(null);
        setLoading(false);
        if (!TERMINAL_TASK_STATUSES.has(result.task.status)) {
          timeoutId = setTimeout(() => {
            void poll(id);
          }, POLL_INTERVAL_MS);
        }
      } catch (pollError) {
        if (cancelled) return;
        setLoading(false);
        setError(pollError instanceof ApiError ? pollError.message : 'Unable to load execution details.');
      }
    }

    void poll(executionId);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [executionId]);

  const refresh = useCallback(() => {
    if (executionId === null) return;
    const requestId = refreshRequestId.current + 1;
    refreshRequestId.current = requestId;

    void (async () => {
      try {
        const result = await getExecutionDetails(executionId);
        if (refreshRequestId.current !== requestId) return;
        setDetails(result);
        setError(null);
      } catch (refreshError) {
        if (refreshRequestId.current !== requestId) return;
        setError(refreshError instanceof ApiError ? refreshError.message : 'Unable to load execution details.');
      }
    })();
  }, [executionId]);

  return { details, loading, error, refresh };
}
