# Architecture

## Shape: modular monolith

One deployable backend process, hard internal module boundaries, no
microservices. Nothing here needs independent scaling or independent
deployment yet, and splitting now would only add network calls between things
that belong in the same transaction. Boundaries are drawn so any module could
be extracted into its own service later without a rewrite: each module owns
its types, talks to others only through an explicit interface, and none reach
into another's persistence directly.

```
apps/
  web/                React + TypeScript + Vite frontend
  api/                Node.js + TypeScript backend (Fastify) — transport only
packages/
  domain/              Shared domain types (Task, Agent, TokenUsage, ...)
  orchestrator/        Application-layer sequencing of the workflow
  context-engine/      Deterministic repo analysis, no LLM calls
  token-intelligence/  Estimation, usage tracking, cost, budgets
  model-router/        Provider-agnostic LLM abstraction + routing rules
  providers/           Anthropic / OpenAI adapters implementing LLMProvider
  workflow-engine/     Explicit task state machine, retries, transitions
  agent-runtime/       Agent implementations (Architect, Developer, QA, ...)
  git-integration/     Isolated git operations (branch/commit/diff)
  persistence/         SQLite repositories, one per aggregate
```

## Human review (Phase 16)

`HUMAN_REVIEW` is the explicit human gate before a task reaches `DONE` — the
only transitions out of it are decided by a human, never by an agent:

```
HUMAN_REVIEW -> DONE      (human approves)
HUMAN_REVIEW -> PLANNING  (human rejects; a new planning/execution cycle can follow)
```

Both are ordinary entries in domain's `TASK_TRANSITIONS` table
(`packages/domain/src/task.ts`) — `canTransition`/`transitionTask` remain
the only source of transition legality. The decision itself is a durable
`HumanReviewDecision` (`packages/domain/src/human-review.ts`, persisted via
`persistence.humanReviewDecisions`), recorded by
`Orchestrator.reviewExecution()` (`packages/orchestrator/src/review.ts`) in
one transaction together with the Task/WorkflowExecution update, so a
decision can never exist without its corresponding transition. Exposed to
the frontend as `POST /executions/:executionId/review` and, for display, as
the `review` field on `ExecutionDetails`/`GET .../details`.

**Human approval is not a Git operation.** It never merges, pushes, opens a
pull request, or touches the approved branch/worktree — those remain
explicitly out of scope. Approving only records "a human accepted this
execution's result"; the artifact it approved stays exactly where the
pipeline left it.

## Safe Git diff (Phase 17)

`GET /executions/:executionId/diff` makes `HUMAN_REVIEW` actually
reviewable: a read-only, structured diff of the execution's isolated AI
worktree against the commit it branched from. It is a query, not a
command — no workflow transition, no `reviewExecution()` call, no agent/
LLM/Context Engine invocation, and no Git write of any kind (no stage,
commit, checkout, reset, clean, merge, rebase, or push) is reachable from
it. The dependency direction is strict:

```
HTTP -> Orchestrator.getExecutionDiff() -> git-integration -> isolated AI worktree
```

Only `packages/git-integration` invokes git or touches the worktree's
filesystem; `apps/api/src/http` never imports it directly, and `apps/web`
never imports any Git package. `AiWorktree.getStructuredDiff()` (alongside
the pre-existing, unchanged `getDiff()` that QA/Developer still use)
produces a `WorktreeDiff` of per-file `{path, status, additions, deletions,
binary, patch}` — paths are always repository-relative, binary files never
return raw content (`patch: null`), and a diff over a configured size limit
withholds patch text (`truncated: true`) rather than silently truncating
individual files.

**Worktree resolution.** `AiWorktree` itself is only an in-memory handle,
discarded once `execute()`'s HTTP response is sent — there was no durable
way to find "the worktree for execution X" again. Phase 17 adds the
smallest durable record needed: `persistence.executionWorktrees` (one row
per execution: `worktreePath`, `branchName`, `baseCommitSha`), written once
by `execute()` right after `createWorktree()` succeeds, and read by
`getExecutionDiff()` to reconstruct a worktree handle via
`GitRepository.resolveWorktree()`. The client supplies only `executionId`
— never a worktree path, branch name, or repository path — so there is no
way to make the server read an arbitrary filesystem location.

## Multi-execution worktree lifecycle (Phase 18)

A task can have more than one `WorkflowExecution` over its lifetime — most
notably after a Phase 16 `HUMAN_REVIEW -> PLANNING` rejection, which is the
official product flow for "try again." Each execution now gets its own
isolated worktree and branch, keyed by that task's 1-indexed execution
count so far (`ai/<task-id>-<slug>-<n>`, worktree directory
`<worktreeRoot>/<task-id>-<n>`), computed once by the Orchestrator from
`persistence.workflowExecutions.findByTaskId()` and passed into
`GitRepository.createWorktree()` — git-integration itself stays
persistence-agnostic, just placing the number where it's told to. Before
this, both were keyed by task id alone, so a task's second execution
collided with artifacts its first execution had already created. Nothing
about branch naming's *format*, worktree *creation* mechanics, or cleanup
behavior otherwise changed — only what makes each execution's path/branch
unique. `persistence.executionWorktrees` already keyed one row per
execution (Phase 17), so no schema change was needed there.

## BYOK: credential management (Phase 19)

The platform holds no LLM credits of its own. Every provider call is made
with a credential the user supplied for a specific project — the platform
only orchestrates. The boundary that exists today is `Project`, not `User`:

```
Project -> ProviderConfiguration -> CredentialReference -> encrypted secret
```

Authentication/user ownership is deliberately **not** implemented yet — see
"Current limitation" below. When it lands, the hierarchy extends to
`User -> Project -> ProviderConfiguration -> Credential` without changing
this phase's tables or contracts; a `Project` would simply gain an owning
user.

**New package: `@aet/credentials`.** A coordinator package, the same tier
as `@aet/orchestrator`, sitting between HTTP and persistence/providers:

```
apps/api/src/http
       |
       v
@aet/credentials  (connect / disconnect / validate / list, + createProjectCredentialProvider)
       |                                  |
       v                                  v
@aet/persistence (CredentialStore,   @aet/providers (LLMProvider.validateCredential(),
  ProjectProviderConfigurationRepo)    used only pre-persistence — never for real calls)
```

`@aet/domain` gained only non-secret types: `ProviderName` (today
`'anthropic'` | `'gemini'` — adding `'openai'` later is meant to
be the only domain-level change a new adapter needs), `ProviderConnectionStatus`
(`connected`/`not_configured`/`invalid`), `CredentialReference` (an opaque
`{id}`), and `ProjectProviderConfiguration`. None of these carry a secret —
`ProjectProviderConfiguration` never gained an `apiKey` field.

**Encryption at rest.** `@aet/persistence`'s `CredentialStore` encrypts
every secret with AES-256-GCM (`node:crypto` only — no external crypto
library, no invented scheme) before it reaches SQLite: the `credentials`
table stores `ciphertext`/`iv`/`auth_tag`/`encryption_version` only, never
plaintext. The master key comes from `CREDENTIAL_ENCRYPTION_KEY` (64 hex
characters / 32 bytes) — never stored in SQLite, never derived from a
project id or the secret itself, and validated eagerly at startup: a
missing or malformed key fails composition immediately, not on the first
credential operation.

**Runtime credential resolution.** `execute()` no longer receives one
shared `AgentRuntime` — the Orchestrator's `createAgentRuntimeForProject(projectId)`
factory (injected by the composition root) builds one scoped to the
executing task's own project, via `createProjectCredentialProvider()`
resolving that project's encrypted Anthropic credential fresh on every
`getApiKey()` call (never cached, never persisted anywhere in
`LLMRequest`/`AgentExecution`/`WorkflowExecution`/logs). `AnthropicProvider`
itself is completely unchanged by this phase — it still only knows about
`CredentialProvider`, never about projects, HTTP, or persistence.
`ANTHROPIC_API_KEY` still exists only as an optional dev/bootstrap
fallback, used only when a project has no connected credential of its own,
and is never returned to the frontend.

**Validation without a wasted generation call.** Connecting or
re-validating a credential calls Anthropic's token-counting endpoint
(`LLMProvider.validateCredential()`, optional on the interface) rather than
a real `generate()` call — it authenticates the key exactly like a real
request would, but never produces output tokens.

**Project isolation** is enforced by construction, not convention:
`project_provider_configurations` has `unique(project_id, provider)`, and
every credential resolution path goes `projectId + provider -> configuration
row -> credentialReference -> secret` — nothing ever accepts a raw
`credentialId` from a caller. See `@aet/credentials`' test suite,
especially `project-isolation.test.ts`, for the guarantee this enforces.

**Current limitation:** there is no authentication yet, so "project-scoped
BYOK" is the real, enforced boundary — not a stand-in for per-user
isolation. `ANTHROPIC_API_KEY` remains available only for local
development/bootstrap and is never part of the BYOK path a connected
project takes.

## Frontend (Phase 15)

`apps/web` is a plain HTTP/UI client of `apps/api` — nothing more. It calls
only the documented REST endpoints (`POST /tasks`, `POST /tasks/:taskId/execute`,
`GET /executions/:executionId`, `GET /executions/:executionId/details`,
`GET /tasks/:taskId/execution`) through one small typed client
(`apps/web/src/api/`), reading `VITE_API_URL` for the API's base URL. It
contains no workflow state machine, no orchestration logic, no token/cost
calculation, no model selection, no repository scanning, and no Git
operations — the workflow stepper and token/context/retry panels only
render fields the backend already computed and returned; nothing is
re-derived in the browser. `apps/api`'s HTTP layer now registers
`@fastify/cors` (a dependency already declared since Phase 11 for this
exact purpose) so a browser app served from a different origin/port can
read its responses — this adds no new endpoint, field, or behavior, only
the ability for a browser client to call the existing API cross-origin.

## Dependency direction

```
apps/api
    |
    +-----------------------+
    v                       v
orchestrator          @aet/credentials
    |                       |         \
    v                       v          v
workflow-engine   agent-runtime   persistence   providers
    |                    |             |             |
context-engine  token-intelligence     v             v
    |                    |           domain        domain
    v                    v
  domain              providers -> domain
```

`apps/api` has two internal layers with different rules. Its **HTTP layer**
(`apps/api/src/http/`, Phase 13) depends only on the already-composed
`ApplicationRuntime` (`orchestrator` + `persistence` handles it exposes, plus
Phase 19's `credentials` handle), composition/config types, and plain data
types that `OrchestrationResult` already returns (`domain`'s
`Task`/`WorkflowExecution`/`TokenBudget`, `agent-runtime`'s
`ArchitectPlan`/`DeveloperOutput`/`QAResult`, `token-intelligence`'s
`TaskTokenMetrics`) — it reuses these types to build response DTOs rather
than re-declaring them, since they are already part of Orchestrator's
public return shape and not a new coupling. It calls `persistence.tasks.create()`
directly for `POST /tasks` and `persistence.projects.create()`/`.list()`
for `POST /projects`/`GET /projects` (the same pattern: plain CRUD with no
use-case logic of its own), because neither Orchestrator nor
`@aet/credentials` has a task/project-creation operation. Every credential
operation goes through `runtime.credentials` (see the BYOK section above),
never through `CredentialStore`/`persistence.credentials`/
`persistence.projectProviderConfigurations` directly. It never imports
`@anthropic-ai/sdk`, `simple-git`, `better-sqlite3`, or any provider/
workflow-FSM internals.
One narrow, deliberate exception: `http/errors.ts` imports
`WorkflowNotFoundError` / `TaskNotFoundError` / `InvalidTransitionError`
from `workflow-engine` and `NotFoundError` / `DuplicateIdError` from
`persistence` purely for `instanceof` checks, to map errors that propagate
unwrapped through `Orchestrator.getStatus()` and `execute()` into correct
HTTP status codes — no logic from either package is invoked.

### Command/query split (Phase 14)

Commands (anything that runs an agent or changes state) and queries
(read-only observability) take different paths:

```
Command: HTTP -> Orchestrator.execute() -> workflow-engine/agent-runtime/context-engine/git-integration/persistence
Query:   HTTP -> ExecutionReadModel     -> persistence
```

`ExecutionReadModel` (`packages/orchestrator/src/read-model/`) is a
read-only projection over already-persisted Tasks, WorkflowExecutions,
AgentExecutions, LLMRequests, and ContextMetrics. It belongs to the
orchestration/application layer (same package as `Orchestrator`, since both
sit above `persistence` and below `apps/api`), but is a separate object
with no dependency on `Orchestrator` itself — it never executes agents,
invokes an LLM or Git, reruns the Context Engine, or mutates anything.
`ApplicationRuntime` exposes it alongside `orchestrator`, and the HTTP
layer's read-only routes (`GET /executions/:executionId/details`,
`GET /tasks/:taskId/execution`) call it directly instead of going through
`Orchestrator.getStatus()` or `execute()`. This phase introduces no new
persisted tables and no new observability infrastructure (no OpenTelemetry/
Prometheus/etc.) — it is purely an application-level read model over data
the platform already stores.

Its **composition/bootstrap layer** (`apps/api/src/composition/`, `apps/api/src/runtime/`)
is the deliberate exception: it is the composition root, so it legitimately
constructs and wires every package below — persistence, git-integration,
model-router, providers, agent-runtime, context-engine, workflow-engine —
before handing a single already-composed `Orchestrator` to the HTTP layer.
`orchestrator` itself is still the only package permitted to *sequence*
across workflow-engine, agent-runtime, context-engine, token-intelligence,
model-router, git-integration, and persistence at request-handling time;
the composition root only *assembles* them once at startup, it never
sequences a workflow.

### Orchestrator (`packages/orchestrator`)

The Orchestrator is an **application-layer module, not a transport-layer
one**. It is the deterministic dispatcher described in AGENT_DESIGN.md (look
up `TaskState`, ask `context-engine` for a `ContextPack`, ask
`token-intelligence` for an estimate and budget check, ask `model-router` for
a provider/model, run the `AgentExecution` via `agent-runtime`, interpret the
deterministic result, emit the event that drives `workflow-engine`'s next
transition). It previously lived inside `apps/api`; it has been extracted
into its own package because:

- it has zero HTTP concerns (no request/response objects, no status codes,
  no SSE framing) and should be unit-testable without a Fastify instance;
- `apps/api`'s job shrinks to what transport layers should do: parse/validate
  the HTTP request, call one orchestrator function, stream/serialize the
  result back. It contains no sequencing logic of its own;
- it keeps the door open for a future non-HTTP entrypoint (a CLI, a queue
  worker) to reuse the exact same sequencing without depending on Fastify.

The Orchestrator must **not** import `fastify`, construct HTTP responses, or
know about SSE/streaming framing — those concerns stay in `apps/api`, which
adapts the Orchestrator's plain async function calls/callbacks to whatever
transport shape the API needs.

`apps/api` composes `orchestrator` for one purpose (route handlers) and
contains almost no logic of its own beyond HTTP/SSE wiring. This is
deliberate: every package above is independently unit-testable without
spinning up a server.

## Why these technology choices

- **Fastify** over Express: first-class TypeScript types on routes/schemas,
  built-in JSON schema validation, lower overhead. No functional need beyond
  that; either would work.
- **better-sqlite3** over Postgres for MVP: zero infra to stand up, synchronous
  API keeps repository code simple, file-based so the whole app runs with
  `npm run dev` and nothing else. The persistence package hides this behind
  repository interfaces so swapping to Postgres later touches one package.
- **React + Vite**: matches the stated stack preference, fast dev loop.
- **npm workspaces**, not Nx/Turborepo: the monorepo has ~10 packages and no
  need yet for remote caching or affected-graph builds. Revisit if build
  times become a problem.
- **Server-Sent Events**, not WebSockets, for live execution updates: traffic
  is one-directional (server -> client), SSE is plain HTTP and needs no extra
  client library.
- **simple-git**, not raw shell-outs: typed wrapper around git CLI, still
  fully auditable (it just shells out), keeps git operations in one place
  (`git-integration`) so nothing else in the codebase can run arbitrary git
  commands.

## Determinism boundary

This is the architectural rule that keeps token spend sane: **anything that
can be computed without an LLM, is.** Concretely, these never touch a model:

- repository/file discovery, `package.json`/`tsconfig` inspection
- git status, diff, branch, commit, log
- import/export and dependency graph extraction
- test execution and pass/fail parsing
- token/cost arithmetic, budget math, relevance scoring

The `context-engine` and `token-intelligence` packages are pure/deterministic
(given filesystem + git state as input) and are unit-tested as such. Only
`agent-runtime` calls out to `model-router` -> `providers`, and every such
call is logged as an `LLMRequest` with full attribution (see DOMAIN_MODEL.md).

## Agent context flow

Agents do **not** share a conversation. The Orchestrator passes each agent a
purpose-built `ContextPack`: structured artifacts from prior agents (e.g. the
Architect's plan, affected files, acceptance criteria) plus the minimal
source excerpts the Context Engine selected for that specific agent's job.
This is why Developer receives "9% of the repository" rather than the whole
thing, and why re-running QA after a Debugger fix doesn't re-send the
Architect's reasoning.

This initial allocation is not a hard ceiling for the rest of the execution.
The Developer may determine mid-task that the plan's named files are
insufficient (e.g. a type it needs to extend lives in a file the Architect
didn't name) and raise a **Context Expansion Request** rather than either
guessing or being permanently blocked. The Developer never calls
`context-engine` or `token-intelligence` directly — it emits a structured
request artifact; the Orchestrator is the only caller of both packages, so it
mediates every expansion the same way it mediated the original allocation.
See AGENT_DESIGN.md for the full expansion flow and DOMAIN_MODEL.md for the
`ContextExpansionRequest` record. The Context Engine remains the sole
authority for *which* files are relevant — expansion is bounded by the same
relevance scoring and budget checks as the initial pack, not an escape hatch
to "send the whole repository."

## Workflow engine

A finite state machine (see AGENT_DESIGN.md for full transition table) with:

- transitions triggered by deterministic events (`TESTS_FAILED`,
  `QA_PASSED`, ...), not by free-form LLM decision-making
- a `retryCount` per task, capped at `MAX_RETRIES` (default 3), after which
  the task moves to `HUMAN_REVIEW` rather than looping forever
- every transition recorded as a `WorkflowEvent` for the execution timeline

The Orchestrator (`packages/orchestrator`) is a thin dispatcher over this
state machine plus the model router and budget checks — not a single giant
LLM prompt deciding what happens next, and not code living inside `apps/api`.

## Observability

Every LLM call and every workflow transition emits a structured event
(`TASK_CREATED`, `CONTEXT_ANALYZED`, `LLM_REQUEST_COMPLETED`,
`TESTS_FAILED`, ...) persisted against the task's `executionId`. The frontend
timeline is a straight read of this event log — there is no separate
"progress" concept to keep in sync.

## Security posture (see SECURITY.md for detail)

Provider credentials are BYOK, stored server-side only, never sent to the
frontend, redacted from all logs. The MVP secret store is an encrypted-at-rest
local file (AES-256-GCM, key from `MASTER_KEY` env var) behind a
`CredentialStore` interface — enough to not be negligent, not an enterprise
secrets manager. Git operations are confined to branch/commit/diff on the
task's own working branch; push and merge require explicit user action.
`git-integration` performs this work in a dedicated **git worktree**, not in
the user's own checked-out working directory — see SECURITY.md for the
decision and reasoning.
