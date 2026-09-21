import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createAgentRuntime, createLLMExecutorRegistry, type AgentRuntime } from '@aet/agent-runtime';
import {
  connectProviderCredential,
  disconnectProviderCredential,
  listProviderConfigurations,
  validateProviderCredential,
  createProjectCredentialProvider,
  CredentialManagementError,
  type CreateProviderForValidation
} from '@aet/credentials';
import { createContextEngine } from '@aet/context-engine';
import type { ProjectId, ProjectProviderConfiguration, Repository, RepositoryId } from '@aet/domain';
import { GitRepository, initializeNewRepository, validateRepository } from '@aet/git-integration';
import type { ModelDescriptor } from '@aet/model-router';
import { createModelCatalog, createModelRouter } from '@aet/model-router';
import { createExecutionReadModel, createOrchestrator, type ExecutionReadModel, type Orchestrator } from '@aet/orchestrator';
import type { Persistence } from '@aet/persistence';
import { createCredentialStore, createPersistence, type CredentialStore } from '@aet/persistence';
import { createAnthropicProvider, createGeminiProvider, createStaticCredentialProvider, type LLMProvider } from '@aet/providers';
import { createHeuristicTokenEstimator } from '@aet/token-intelligence';
import { createWorkflowEngine } from '@aet/workflow-engine';
import type { ApplicationConfig } from './config.js';
import { RepositoryManagementError, StartupError } from './errors.js';

function sanitizeStartupCause(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'UnknownError', message: 'A non-Error value was thrown during startup' };
}

/**
 * Not a live pricing database — `pricing: null` on every entry preserves
 * the existing nullable/injected pricing behavior (see model-router's
 * `ModelDescriptor.pricing` and token-intelligence's `PricingTable`,
 * neither of which this phase invents real dollar figures for). Gemini's
 * `pricing: null` reflects its free tier honestly: $0 is a real price, not
 * an unknown one.
 *
 * `tier: 'strong'` on Anthropic vs `tier: 'mid'` on Gemini is the entire
 * mechanism behind "prefer Claude for Developer/Debugger" (Phase 20.5) —
 * Model Router's existing, unmodified ranking (selection.ts) sorts a
 * `matchedPreferredTier` candidate first, and Developer/Debugger both
 * prefer `'strong'`. When only Gemini is connected for a project, it's the
 * sole valid candidate regardless of tier, so it's still selected —
 * "prefer Claude" degrades to "use whatever's connected," never to
 * "refuse to run."
 */
function buildAnthropicCatalogEntry(): ModelDescriptor {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    capabilities: ['reasoning', 'code', 'tool_use', 'structured_output', 'long_context'],
    contextLimit: 200_000,
    outputLimit: 8_192,
    tier: 'strong',
    pricing: null,
    available: true
  };
}

function buildGeminiCatalogEntry(model: string): ModelDescriptor {
  return {
    provider: 'gemini',
    model,
    // 'structured_output' included: Architect's JSON-plan requirement is satisfied by prompting +
    // execution.ts's stripCodeFence parsing (see agent-runtime), the same mechanism used for
    // Anthropic — there is no provider-native structured-output API this depends on.
    capabilities: ['reasoning', 'code', 'structured_output'],
    // Google's published spec for the 3.6 Flash line: 1,048,576 input tokens / 65,536 output tokens.
    contextLimit: 1_048_576,
    outputLimit: 65_536,
    // 'strong' (not 'mid'): Model Router's ranking is a boolean tier-MATCH against the calling
    // role's own preferredTier, never an ordinal "strong > mid > low_cost" comparison (see
    // model-router's selection.ts — matchedPreferredTier is `tier === request.preferredTier`,
    // nothing more). Architect/Developer/Debugger/Security all prefer 'strong'; leaving this at
    // 'mid' meant NEITHER this entry nor the fallback below (also non-'strong') ever matched for
    // those roles, so ranking fell through to alphabetical — which put the fallback model first by
    // accident, backwards from intent. Caught live: gemini-3.5-flash-lite was being tried before
    // gemini-3.6-flash. A connected Anthropic credential still wins over either Gemini entry
    // regardless of this value — see buildGeminiFallbackCatalogEntry's doc comment.
    tier: 'strong',
    pricing: null,
    available: true
  };
}

/**
 * A separate, distinct Gemini model — NOT a second provider connection, no
 * new credential, no new signup — added purely so `invokeLLM`'s existing
 * cross-candidate fallback (agent-runtime's execution.ts, which already
 * walks Model Router's ranked `fallbacks` list) has something real to fall
 * through to on the SAME already-connected Gemini credential. Caught live:
 * `gemini-3.6-flash` returning "HTTP 503: This model is currently
 * experiencing high demand" — a capacity/overload condition specific to
 * that one model's own serving pool, not to the Gemini API or the user's
 * key. A different model is very likely served on separate capacity, so it
 * is not subject to the same overload at the same moment.
 *
 * `tier: 'low_cost'` here (vs. the primary entry's `'strong'`, see its own
 * doc comment) means this loses the tier-match tiebreak — and therefore
 * ranks after the primary entry — for every role that currently runs
 * (Architect/Developer prefer 'strong'). QA prefers 'low_cost' itself, so
 * for QA specifically this entry becomes the PREFERRED pick and the primary
 * entry its fallback — intentional, not a bug: QA's job (interpreting an
 * already-produced diff/test result) doesn't need the stronger model by
 * default, and having it available as QA's own fallback still preserves
 * resilience against this exact kind of one-model overload.
 *
 * A connected Anthropic credential still wins over both Gemini entries for
 * every 'strong'-preferring role: Anthropic's own catalog entry is also
 * `tier: 'strong'`, so it ties on tier-match with this project's primary
 * Gemini entry, and the tiebreak falls to estimated cost — skipped because
 * Gemini's `pricing` is null — and finally to alphabetical ordering of
 * `provider/model`, where `"anthropic/..."` sorts before `"gemini/..."`.
 */
function buildGeminiFallbackCatalogEntry(): ModelDescriptor {
  return {
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    capabilities: ['reasoning', 'code', 'structured_output'],
    contextLimit: 1_048_576,
    outputLimit: 65_536,
    tier: 'low_cost',
    pricing: null,
    available: true
  };
}

/**
 * A project's catalog is built fresh per execution from which providers it
 * actually has connected — never a single static, shared catalog. A
 * provider absent here is simply never a candidate Model Router can
 * select; this is the only place "is this provider usable for this
 * project" is decided.
 */
function buildCatalogForProject(
  persistence: Pick<Persistence, 'projectProviderConfigurations'>,
  config: ApplicationConfig,
  projectId: ProjectId
): readonly ModelDescriptor[] {
  const entries: ModelDescriptor[] = [];

  const anthropicConfig = persistence.projectProviderConfigurations.findByProjectAndProvider(projectId, 'anthropic');
  if (anthropicConfig?.status === 'connected' || config.anthropicApiKey !== null) {
    entries.push(buildAnthropicCatalogEntry());
  }

  const geminiConfig = persistence.projectProviderConfigurations.findByProjectAndProvider(projectId, 'gemini');
  if (geminiConfig?.status === 'connected') {
    entries.push(buildGeminiCatalogEntry(config.geminiModel));
    // Only add the fallback entry when it's actually a different model — if a project ever
    // configures GEMINI_MODEL to be flash-lite itself, a duplicate candidate would just be noise.
    if (config.geminiModel !== 'gemini-3.5-flash-lite') {
      entries.push(buildGeminiFallbackCatalogEntry());
    }
  }

  return entries;
}

/**
 * The BYOK application surface (Phase 19) — every method returns only the
 * non-secret `ProjectProviderConfiguration`; none can return, and none
 * internally logs, a plaintext API key. `apps/api/src/http` calls these
 * and nothing else for credential management — it never touches
 * `CredentialStore`, `persistence.credentials`, or `persistence.projectProviderConfigurations` directly.
 */
export interface CredentialManagementRuntime {
  connectProvider(input: { projectId: ProjectId; provider: string; apiKey: string }): Promise<ProjectProviderConfiguration>;
  disconnectProvider(input: { projectId: ProjectId; provider: string }): Promise<ProjectProviderConfiguration>;
  validateProvider(input: { projectId: ProjectId; provider: string }): Promise<ProjectProviderConfiguration>;
  listProviders(projectId: ProjectId): readonly ProjectProviderConfiguration[];
}

/**
 * Phase 21 (repository selection) application surface — `apps/api/src/http`
 * calls these and nothing else for repository management; it never touches
 * `persistence.repositories`, `GitRepository`, or `@aet/git-integration`
 * directly. `register` validates an existing folder on disk (throws
 * `RepositoryManagementError` if it isn't a usable git repository);
 * `createNew` scaffolds one from scratch (see git-integration's
 * `initializeNewRepository`) for a task submitted with no repository
 * selected.
 */
export interface RepositoryManagementRuntime {
  register(input: { projectId: ProjectId; name: string; path: string }): Promise<Repository>;
  createNew(input: { projectId: ProjectId; name: string }): Promise<Repository>;
  list(projectId: ProjectId): readonly Repository[];
}

export interface Application {
  readonly orchestrator: Orchestrator;
  readonly persistence: Persistence;
  /** Read-only projection over persisted execution data — see @aet/orchestrator's read-model. Never used to command anything; only `orchestrator` executes tasks. */
  readonly executionReadModel: ExecutionReadModel;
  /** BYOK credential management (Phase 19) — see CredentialManagementRuntime's own doc comment. */
  readonly credentials: CredentialManagementRuntime;
  /** Repository selection (Phase 21) — see RepositoryManagementRuntime's own doc comment. */
  readonly repositories: RepositoryManagementRuntime;
  close(): void;
}

/**
 * The only place this application decides which concrete `LLMProvider`
 * adapter backs a given `ProviderName` string. Used for two purposes only:
 * validating a candidate API key before it is ever persisted (connect/
 * validate flows, via @aet/credentials) — never for a real generation
 * call. @aet/credentials itself never imports @aet/providers' Anthropic
 * adapter or branches on a provider name; this is the one seam where that
 * knowledge legitimately lives, exactly like `buildDefaultModelCatalogEntries` above.
 */
const createProviderForValidation: CreateProviderForValidation = (provider, connectionValue) => {
  if (provider === 'anthropic') {
    return createAnthropicProvider({ credentialProvider: createStaticCredentialProvider(connectionValue) });
  }
  if (provider === 'gemini') {
    return createGeminiProvider({ credentialProvider: createStaticCredentialProvider(connectionValue) });
  }
  throw new CredentialManagementError('provider_not_supported', `Provider "${provider}" is not supported`);
};

/**
 * The application composition root: the one place every package's factory
 * is called and wired together. Nothing downstream of this (Orchestrator,
 * Agent Runtime, agents, Workflow Engine) ever constructs a concrete
 * provider, opens a database, or opens a repository itself — they all
 * receive already-built instances as explicit constructor/factory
 * arguments. No service locator, no singleton, no DI framework: this is
 * one function calling other functions in dependency order.
 */
export async function createApplication(config: ApplicationConfig): Promise<Application> {
  // 1. Persistence — the first real resource. If nothing after this succeeds, it must be closed before rethrowing.
  const persistence = createPersistence(config.databasePath);

  // 1.5. Credential Store — parses/validates CREDENTIAL_ENCRYPTION_KEY eagerly (see
  // createCredentialStore's own doc comment): a malformed key fails startup here, immediately,
  // rather than surfacing as an obscure failure the first time someone connects a provider.
  let credentialStore: CredentialStore;
  try {
    credentialStore = createCredentialStore({ credentialRepository: persistence.credentials, masterKey: config.credentialEncryptionKey });
  } catch (error) {
    persistence.close();
    throw new StartupError('Invalid CREDENTIAL_ENCRYPTION_KEY configuration', { cause: sanitizeStartupCause(error) });
  }

  // 2–10. Everything below is pure object/closure construction (no I/O, nothing that can fail in
  // practice today — e.g. the Anthropic client itself is only constructed lazily inside its first
  // `generate()` call, per packages/providers). Still wrapped, so a future factory that DOES validate
  // eagerly fails safely instead of leaking the two resources already open above.
  try {
    // Token estimator (shared by Context Engine and Agent Runtime — same instance, same heuristic).
    const tokenEstimator = createHeuristicTokenEstimator();

    // Phase 19 (BYOK) + Phase 22 (Gemini): both the model catalog/router AND the AgentRuntime
    // are built fresh per execution, scoped to that execution's own project — never one
    // globally-shared instance, since which providers are even eligible candidates now depends on
    // which ones this specific project has connected (see buildCatalogForProject).
    // `createProjectCredentialProvider` resolves each connected provider's own encrypted
    // credential at call time (falling back to `config.anthropicApiKey` — dev/bootstrap only —
    // for Anthropic when the project has none connected); the adapters themselves stay exactly as
    // before, knowing nothing about projects, persistence, or BYOK. This is the only place
    // @aet/providers is imported outside packages/providers itself.
    function createAgentRuntimeForProject(projectId: ProjectId): AgentRuntime {
      const catalogEntries = buildCatalogForProject(persistence, config, projectId);
      const modelCatalog = createModelCatalog(catalogEntries);
      const modelRouter = createModelRouter(modelCatalog);

      const providers: LLMProvider[] = [];
      if (catalogEntries.some((entry) => entry.provider === 'anthropic')) {
        const credentialProvider = createProjectCredentialProvider({
          projectId,
          provider: 'anthropic',
          persistence: { projectProviderConfigurations: persistence.projectProviderConfigurations },
          credentialStore,
          fallbackApiKey: config.anthropicApiKey
        });
        providers.push(createAnthropicProvider({ credentialProvider }));
      }
      if (catalogEntries.some((entry) => entry.provider === 'gemini')) {
        const credentialProvider = createProjectCredentialProvider({
          projectId,
          provider: 'gemini',
          persistence: { projectProviderConfigurations: persistence.projectProviderConfigurations },
          credentialStore
          // No fallback: unlike Anthropic's dev-bootstrap env var, Gemini always requires an
          // explicit BYOK connection — there's no equivalent "just works" default.
        });
        providers.push(createGeminiProvider({ credentialProvider }));
      }

      const executorRegistry = createLLMExecutorRegistry(providers);
      return createAgentRuntime({ modelRouter, executorRegistry, tokenEstimator });
    }

    // Phase 21 (repository selection): resolves a `GitRepository` handle from a task's
    // `repositoryId`, opening whatever folder that registered `Repository` row points at — never a
    // single, fixed repository for the whole application. Called once per `execute()`
    // (orchestrator.ts), exactly like `createAgentRuntimeForProject` above.
    async function createGitRepositoryForTask(repositoryId: RepositoryId): Promise<GitRepository> {
      const repository = persistence.repositories.findById(repositoryId);
      if (repository === null) {
        throw new RepositoryManagementError('repository_not_found', `Repository not found: ${repositoryId}`);
      }
      const { repository: gitRepository } = await GitRepository.open(repository.localPath, config.worktreeRoot);
      return gitRepository;
    }

    // Phase 21 (repository selection): the application surface `apps/api/src/http` calls to
    // register an existing repository or scaffold a brand-new one for a project. Mirrors
    // `CredentialManagementRuntime`'s shape/placement — a thin object of closures over
    // `persistence`, never exposing `persistence.repositories` directly to the HTTP layer.
    async function registerRepository(input: { projectId: ProjectId; name: string; path: string }): Promise<Repository> {
      if (persistence.projects.findById(input.projectId) === null) {
        throw new RepositoryManagementError('project_not_found', `Project not found: ${input.projectId}`);
      }
      let descriptor;
      try {
        descriptor = await validateRepository(input.path);
      } catch (error) {
        throw new RepositoryManagementError('invalid_repository_path', `"${input.path}" is not a usable git repository`, {
          cause: error
        });
      }
      const repository: Repository = {
        id: randomUUID(),
        projectId: input.projectId,
        name: input.name,
        localPath: descriptor.path,
        defaultBranch: descriptor.defaultBranch,
        remoteUrl: null,
        createdAt: new Date().toISOString()
      };
      persistence.repositories.create(repository);
      return repository;
    }

    async function createNewRepository(input: { projectId: ProjectId; name: string }): Promise<Repository> {
      if (persistence.projects.findById(input.projectId) === null) {
        throw new RepositoryManagementError('project_not_found', `Project not found: ${input.projectId}`);
      }
      const id = randomUUID();
      const path = join(config.generatedReposRoot, id);
      let descriptor;
      try {
        descriptor = await initializeNewRepository(path, input.name);
      } catch (error) {
        throw new RepositoryManagementError('invalid_repository_path', `Failed to scaffold a new repository for "${input.name}"`, {
          cause: error
        });
      }
      const repository: Repository = {
        id,
        projectId: input.projectId,
        name: input.name,
        localPath: descriptor.path,
        defaultBranch: descriptor.defaultBranch,
        remoteUrl: null,
        createdAt: new Date().toISOString()
      };
      persistence.repositories.create(repository);
      return repository;
    }

    const repositories: RepositoryManagementRuntime = {
      register: registerRepository,
      createNew: createNewRepository,
      list: (projectId) => persistence.repositories.findByProject(projectId)
    };

    const contextEngine = createContextEngine({ tokenEstimator });
    const workflowEngine = createWorkflowEngine({ persistence });

    // Orchestrator — the last thing built, since it depends on everything above. It never
    // receives the CredentialStore or any secret — only the factory above, which it calls once
    // per execution (see @aet/orchestrator's OrchestratorDependencies doc comment).
    // `modelRouter` is intentionally omitted: it's now built fresh per project inside
    // `createAgentRuntimeForProject` (see above), and OrchestratorDependencies' own `modelRouter`
    // field was already documented as "accepted for contract completeness... never called
    // directly" — there is no longer one single shared instance to pass here.
    const orchestrator = createOrchestrator({
      workflowEngine,
      createAgentRuntimeForProject,
      contextEngine,
      createGitRepositoryForTask,
      persistence
    });

    // Execution Read Model — a query-only projection over `persistence`, built independently of
    // Orchestrator. It never sequences a workflow or invokes an agent; see @aet/orchestrator's
    // read-model/execution-read-model.ts for the read-only contract this must uphold.
    const executionReadModel = createExecutionReadModel(persistence);

    // Credential management (Phase 19) — apps/api/src/http calls only these four methods; none
    // can return a secret, and none is used anywhere in the execution path above (that path goes
    // through createProjectCredentialProvider directly, not through this object).
    const credentialManagementDeps = {
      persistence: { projects: persistence.projects, projectProviderConfigurations: persistence.projectProviderConfigurations, transaction: persistence.transaction },
      credentialStore,
      createProviderForValidation
    };
    const credentials: CredentialManagementRuntime = {
      connectProvider: (input) => connectProviderCredential(credentialManagementDeps, input),
      disconnectProvider: (input) => disconnectProviderCredential(credentialManagementDeps, input),
      validateProvider: (input) => validateProviderCredential(credentialManagementDeps, input),
      listProviders: (projectId) => listProviderConfigurations(credentialManagementDeps.persistence, projectId)
    };

    return {
      orchestrator,
      persistence,
      executionReadModel,
      credentials,
      repositories,
      close(): void {
        persistence.close();
      }
    };
  } catch (error) {
    persistence.close();
    throw new StartupError('Failed to compose application dependencies', { cause: sanitizeStartupCause(error) });
  }
}
