# Security

## Scope for MVP

Safest simple implementation, not an enterprise secrets platform. Revisit if
this becomes multi-tenant or handles credentials for users other than the
single operator running the instance.

## Provider credentials (BYOK)

- Keys are supplied by the user (env var or the settings UI) and stored only
  server-side, in `packages/persistence`'s `ProviderCredential` table.
- At rest, key material is encrypted with AES-256-GCM using a key derived
  from `MASTER_KEY` (env var, required in production, never committed).
  Implementation: `packages/persistence/src/crypto.ts`.
- Keys are never sent to the frontend in any API response — the credential
  API returns metadata only (provider, last-4, created/rotated timestamps).
- Keys are never logged. `packages/domain`'s logger redacts any field named
  `apiKey`/`key`/`secret`/`token` (case-insensitive) plus the raw value if it
  matches a known provider key prefix pattern (`sk-ant-`, `sk-`), as a
  belt-and-suspenders measure on top of not logging them in the first place.
- The system never assumes a Claude/ChatGPT/Copilot *consumer* subscription
  grants API access. Only credentials explicitly entered as API keys are
  used, and the credential form says as much.

## Git operations

- Confined to `packages/git-integration`, the only module allowed to shell
  out to `git`. Everything else calls its typed functions.
- Every task works on its own branch (`ai/<task-id>-<slug>`), created off the
  repo's default branch. The system never commits directly to the default
  branch.
- `push` and `merge` are never invoked automatically. Push is a distinct,
  explicit user action in the UI, separate from "approve"; merge is entirely
  manual (the human does it in their normal git host, outside this tool, for
  MVP — see ROADMAP.md for PR-creation as a later step).
- No destructive git commands (`reset --hard`, `clean -f`, force-push) are
  ever issued by the system.

### Decision: git worktree, not branch-only, in the user's working directory

**Decision: use a temporary `git worktree` per task, not branch/checkout
operations against the user's existing working directory. This applies from
MVP 0.1, not as a later hardening pass.**

Reasoning:

- The pipeline both writes real files (Developer's diff) and executes real
  commands (QA's test run) against the checked-out state of the branch. If
  `git-integration` ran `checkout ai/<task-id>-<slug>` inside the same
  working directory the user has open in their editor/IDE, this would: (1)
  switch the user's HEAD out from under them mid-session, (2) risk colliding
  with or discarding the user's own uncommitted changes, and (3) trigger the
  user's file watchers/IDE/test runner on files the *system* is editing, not
  the user.
- A `git worktree` (`git worktree add <path> ai/<task-id>-<slug>`) gives the
  task an independent working directory backed by the same repository and
  object store, with its own `HEAD`, entirely isolated from whatever the user
  currently has checked out. This requires no new infrastructure or
  dependency — it is a native `git` feature already reachable through
  `simple-git`.
- This is a correctness/safety requirement, not speculative hardening: the
  concrete failure mode (branch switch under an open editor, or a test run
  clobbering unstaged user edits) is something the MVP's very first real
  execution would hit on any repository the user is actively working in.
- Worktrees are removed (`git worktree remove`) once a task reaches a
  terminal state (`DONE`/`FAILED`) or is abandoned; the branch itself is left
  intact in the repository for the user to inspect, push, or delete.

This is a documentation decision only for this pass — `git-integration`'s
implementation should create/use a worktree rather than checking out the
task branch in place, but that implementation lands when `git-integration`
itself is built (see the implementation order), not in this review.

## Command execution

- The QA agent's test runner executes a command from the *project's own*
  configuration (`package.json` `scripts.test` or an explicit per-project
  setting), never a command constructed from LLM output or free-form user
  input, to avoid injection via task descriptions.
- Developer agent file writes are constrained to paths inside the target
  repository root (path-traversal checked in `git-integration`'s file-write
  helper before any write).

## Application security

- Strict TypeScript, input validation on every API route via Fastify JSON
  schema (rejects malformed bodies before handler code runs).
- No secrets in the frontend bundle; the frontend never receives an API key,
  only display-safe credential metadata.
- Standard web hygiene: CORS restricted to the configured frontend origin,
  no `eval`/dynamic code execution of LLM output.

## Threat model explicitly out of scope for MVP

Multi-tenant isolation, RBAC beyond a single operator, SSO, audit-log
tamper-evidence, secret rotation automation. Called out here so it's a
deliberate deferral, not an oversight.
