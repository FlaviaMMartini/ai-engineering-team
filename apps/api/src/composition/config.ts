/**
 * The one place environment variables are read for composition purposes.
 *
 * Phase 19 (BYOK): `anthropicApiKey` is now OPTIONAL. Real execution
 * resolves an LLM credential per-project (see @aet/credentials'
 * `createProjectCredentialProvider`, wired in composition-root.ts) — this
 * field only ever serves as a dev/bootstrap fallback used when a project
 * has no connected provider of its own, and it is never surfaced to the
 * frontend or preferred over a real project credential. `credentialEncryptionKey`
 * is the one genuinely required secret left: without it, no credential can
 * be encrypted or decrypted at all, so its absence fails composition
 * immediately rather than surfacing as an obscure failure the first time
 * someone tries to connect a provider.
 */
export interface ApplicationConfig {
  /** Dev/bootstrap-only fallback — see this interface's own doc comment. Never required, never logged. */
  anthropicApiKey: string | null;
  /** Master key for @aet/persistence's CredentialStore (AES-256-GCM) — 64 hex characters (32 bytes). Never logged, never persisted, never returned by any endpoint. */
  credentialEncryptionKey: string;
  /** SQLite file path, or ':memory:'. */
  databasePath: string;
  /** Where isolated task worktrees are created — never the user's own working directory. */
  worktreeRoot: string;
  /**
   * Phase 21 (repository selection): where a brand-new repository is
   * scaffolded when a task is submitted with no repository selected (see
   * git-integration's `initializeNewRepository`). Registering an EXISTING
   * repository instead goes through `POST /projects/:projectId/repositories`
   * with a path anywhere on disk — this root only applies to repositories
   * this application creates itself.
   */
  generatedReposRoot: string;
  /** Phase 22: the Gemini model name used in the per-project catalog entry when a project has Gemini connected — not a secret, just naming which model to request. */
  geminiModel: string;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApplicationConfig {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
    credentialEncryptionKey: readRequiredEnv(env, 'CREDENTIAL_ENCRYPTION_KEY'),
    databasePath: env.AET_DATABASE_PATH ?? './data/aet.sqlite',
    worktreeRoot: env.AET_WORKTREE_ROOT ?? './data/worktrees',
    generatedReposRoot: env.AET_GENERATED_REPOS_ROOT ?? './data/generated-repos',
    geminiModel: env.GEMINI_MODEL ?? 'gemini-3.6-flash'
  };
}

/** Every `ApplicationConfig` field except the secrets — the only shape ever safe to log, print, or include in diagnostics. */
export type SafeConfigSummary = Omit<ApplicationConfig, 'anthropicApiKey' | 'credentialEncryptionKey'>;

export function toSafeConfigSummary(config: ApplicationConfig): SafeConfigSummary {
  return {
    databasePath: config.databasePath,
    worktreeRoot: config.worktreeRoot,
    generatedReposRoot: config.generatedReposRoot,
    geminiModel: config.geminiModel
  };
}

/**
 * HTTP transport configuration — deliberately a separate type from
 * `ApplicationConfig`. Nothing in `composition-root.ts` needs a host/port;
 * only `apps/api/src/http` does. Kept in this same file anyway because
 * this remains the one place environment variables are read (see this
 * file's own top-of-file doc comment) — scattering `process.env` reads
 * into the HTTP layer would violate that boundary.
 */
export interface HttpConfig {
  host: string;
  port: number;
}

export function loadHttpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  return {
    host: env.HTTP_HOST ?? '0.0.0.0',
    port: Number(env.HTTP_PORT ?? '3000')
  };
}
