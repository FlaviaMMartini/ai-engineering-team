import type { ExecutionReadModel, Orchestrator } from '@aet/orchestrator';
import type { Persistence } from '@aet/persistence';
import type { Application, ApplicationConfig, CredentialManagementRuntime, RepositoryManagementRuntime } from '../composition/index.js';
import { createApplication } from '../composition/index.js';
import { ShutdownError } from './errors.js';

/**
 * Owns the lifecycle of an already-composed `Application` — it does not
 * build anything itself (that's composition-root.ts's job) and it does not
 * sequence any workflow/agent/Git/token logic (that's Orchestrator's job).
 * Its only responsibilities are: expose the Orchestrator (and, as of
 * Phase 13, `persistence` — the HTTP task-creation route needs
 * `TaskRepository` and Orchestrator has no "create a task" operation of
 * its own; exposing the already-composed `Persistence` here is the
 * sanctioned way to reach it, rather than the HTTP layer constructing a
 * second connection), and start/stop exactly once, idempotently.
 */
export interface ApplicationRuntime {
  readonly orchestrator: Orchestrator;
  readonly persistence: Persistence;
  /** Read-only observability projection (Phase 14) — see @aet/orchestrator's ExecutionReadModel. */
  readonly executionReadModel: ExecutionReadModel;
  /** BYOK credential management (Phase 19) — see composition-root.ts's CredentialManagementRuntime. */
  readonly credentials: CredentialManagementRuntime;
  /** Repository selection (Phase 21) — see composition-root.ts's RepositoryManagementRuntime. */
  readonly repositories: RepositoryManagementRuntime;
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

function sanitizeShutdownCause(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'UnknownError', message: 'A non-Error value was thrown during shutdown' };
}

/**
 * Wraps an already-composed `Application`. `start()` is intentionally a
 * guarded no-op today: composition (see ../composition/composition-root.ts)
 * already performs all real initialization — opening Persistence,
 * validating and opening the Git repository — before this function is ever
 * called. It exists as the named lifecycle point Phase 13's entrypoint
 * calls (and where a future readiness check would go) without needing to
 * change that entrypoint's shape later.
 *
 * Resource ownership: this runtime owns Persistence and GitRepository
 * (via `application.close()`, which only closes Persistence — see this
 * module's own doc comment on why GitRepository needs no release). It
 * only *references* the Orchestrator; it never closes resources it did
 * not create, and neither does the Orchestrator, Agent Runtime, or
 * Workflow Engine — resource lifecycle stays exclusively at this boundary.
 */
export function createApplicationRuntime(application: Application): ApplicationRuntime {
  let started = false;
  let shutdownStarted = false;

  return {
    orchestrator: application.orchestrator,
    persistence: application.persistence,
    executionReadModel: application.executionReadModel,
    credentials: application.credentials,
    repositories: application.repositories,

    async start(): Promise<void> {
      if (started) return;
      started = true;
    },

    async shutdown(): Promise<void> {
      if (shutdownStarted) return;
      shutdownStarted = true;

      // GitRepository (git-integration) exposes no close()/dispose() and needs none: simple-git
      // spawns one git process per command rather than holding a persistent connection or file
      // handle, so there is nothing to release. Only Persistence owns a real resource (the SQLite
      // handle), released via `application.close()`.
      try {
        application.close();
      } catch (error) {
        throw new ShutdownError('Failed to release application resources cleanly', {
          cause: sanitizeShutdownCause(error)
        });
      }
    }
  };
}

/**
 * The single call Phase 13's entrypoint needs: configuration in,
 * a ready-to-use runtime out. Composes, wraps, and starts — matching this
 * phase's stated diagram (configuration -> bootstrap -> composition root
 * -> application runtime -> Orchestrator) as one function.
 */
export async function bootstrap(config: ApplicationConfig): Promise<ApplicationRuntime> {
  const application = await createApplication(config);
  const runtime = createApplicationRuntime(application);
  await runtime.start();
  return runtime;
}
