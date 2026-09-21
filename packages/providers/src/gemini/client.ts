import type { CredentialProvider } from '../types.js';
import { GeminiHttpError } from './errors.js';

export interface GeminiClientConfig {
  credentialProvider: CredentialProvider;
}

export interface GeminiPart {
  text: string;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: readonly GeminiPart[];
}

export interface GeminiGenerateRequest {
  contents: readonly GeminiContent[];
  systemInstruction?: { parts: readonly GeminiPart[] };
  generationConfig: {
    maxOutputTokens: number;
    temperature?: number;
    responseMimeType?: string;
    thinkingConfig?: { thinkingBudget: number };
  };
}

export interface GeminiCandidate {
  content?: { parts?: readonly GeminiPart[]; role?: string };
  finishReason?: string;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiGenerateResponse {
  candidates?: readonly GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
/** Free-tier Gemini Flash models are fast — generous but bounded, matching every other adapter's "never hang forever" rule. */
const GENERATE_TIMEOUT_MS = 120_000;
const VALIDATE_TIMEOUT_MS = 10_000;

/**
 * Google's 429 body carries a machine-readable retry hint — a
 * `google.rpc.RetryInfo` detail with a `retryDelay` field like `"29s"` — on
 * top of the human-readable message that already says "Please retry in
 * 29.33s." Without reading this, `mapGeminiError` had no way to tell our own
 * retry loop how long Google actually wants us to wait, so it fell back to
 * a generic 2s/5s backoff — far too short against a real quota window,
 * meaning a "retryable" rate-limit error retried into the exact same 429
 * every time instead of ever actually recovering.
 */
function parseRetryDelaySeconds(details: unknown): number | null {
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue;
    const retryDelay = (detail as Record<string, unknown>).retryDelay;
    if (typeof retryDelay === 'string') {
      const match = /^([\d.]+)s$/.exec(retryDelay);
      if (match?.[1] !== undefined) return Number(match[1]);
    }
  }
  return null;
}

async function extractErrorInfo(response: Response): Promise<{ message: string; retryDelaySeconds: number | null }> {
  try {
    const body = (await response.json()) as { error?: { message?: string; details?: unknown } };
    if (typeof body.error?.message === 'string') {
      return { message: body.error.message, retryDelaySeconds: parseRetryDelaySeconds(body.error.details) };
    }
  } catch {
    // Response body wasn't JSON (or had no error.message) — fall through to a generic message.
  }
  return { message: `HTTP ${response.status}`, retryDelaySeconds: null };
}

export async function callGeminiGenerate(
  config: GeminiClientConfig,
  model: string,
  request: GeminiGenerateRequest
): Promise<GeminiGenerateResponse> {
  const apiKey = await config.credentialProvider.getApiKey();
  const response = await fetch(`${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS)
  });
  if (!response.ok) {
    const { message, retryDelaySeconds } = await extractErrorInfo(response);
    throw new GeminiHttpError(response.status, message, retryDelaySeconds);
  }
  return (await response.json()) as GeminiGenerateResponse;
}

/** Lists available models rather than generating a token — confirms the key is accepted without wasting a paid/rate-limited call, matching the Anthropic/every-other-adapter validation approach. */
export async function validateGeminiCredential(config: GeminiClientConfig): Promise<void> {
  const apiKey = await config.credentialProvider.getApiKey();
  const response = await fetch(`${BASE_URL}/models`, {
    headers: { 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS)
  });
  if (!response.ok) {
    const { message, retryDelaySeconds } = await extractErrorInfo(response);
    throw new GeminiHttpError(response.status, message, retryDelaySeconds);
  }
}
