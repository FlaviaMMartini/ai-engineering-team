import type { ApiErrorBody } from '../types/api.js';

/** One place the API's base URL is read from — see Vite's `VITE_API_URL` env var. Never hardcoded elsewhere. */
const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** A safe, user-displayable error — never a raw stack trace or HTTP body dump. */
export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number | null;

  constructor(message: string, code: string, statusCode: number | null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const body: unknown = await response.json();
    if (isApiErrorBody(body)) {
      return new ApiError(body.error.message, body.error.code, response.status);
    }
  } catch {
    // Response body wasn't JSON (or was empty) — fall through to the generic message below.
  }
  return new ApiError('The API returned an unexpected error.', 'UNKNOWN_ERROR', response.status);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
}

/**
 * The only place `fetch` is called from this app. Every endpoint function
 * in api/tasks.ts and api/executions.ts goes through this — no component
 * ever calls `fetch` directly.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const init: RequestInit = { method: options.method ?? 'GET' };
  if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError('Unable to connect to the API.', 'NETWORK_ERROR', null);
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as T;
}
