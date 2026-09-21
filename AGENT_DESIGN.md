# Agent Design & Workflow

## Orchestrator / Tech Lead

Not an LLM prompt — a deterministic dispatcher living in `packages/orchestrator`,
an application-layer package with no HTTP dependency (it sits between
`apps/api` and `workflow-engine`/`agent-runtime`/etc. — see ARCHITECTURE.md's
"Dependency direction"). Its job per task:

1. Look up current `TaskState`, decide the next stage from a static
   transition table (below).
2. Ask `context-engine` to build a `ContextPack` for that stage (no LLM).
3. Ask `token-intelligence` to estimate cost for that stage; check against
   `TokenBudget`. If over budget: shrink context, or downgrade model, or stop
   and raise `HUMAN_REVIEW` — in that order — never silently overspend.
4. Ask `model-router` which provider/model to use for this agent + task
   complexity.
5. Run the `AgentExecution`, record the `LLMRequest`/`TokenUsage`.
6. Interpret the deterministic result of the stage (test exit code, diff
   presence, etc.) and emit the event that drives the next transition.
7. Enforce `MAX_RETRIES` (default 3) per stage; beyond that, transition to
   `HUMAN_REVIEW`.

## State machine

### 0.1a (current implementation) vs. future

The domain layer implements the **0.1a walking skeleton** state machine,
which does **not** include a `CODE_REVIEW` state — `QA` passing goes
directly to `HUMAN_REVIEW`:

```
0.1a:    QA -> HUMAN_REVIEW
future:  QA -> CODE_REVIEW -> HUMAN_REVIEW
```

This is a deliberate, temporary scope cut (see the architecture review's
overengineering check), not an abandonment of the Code Reviewer agent
described below. When the Code Reviewer agent is implemented, `CODE_REVIEW`
is added back into `packages/domain/src/task.ts`'s `TaskState` union and
transition table as its own phase, with tests added alongside it — it is
not part of the domain layer today. Everything else in this document
(including the Code Reviewer agent's own description) describes the
intended full pipeline; only the state machine's `CODE_REVIEW` node is
deferred.

```
BACKLOG -> PLANNING -> READY -> IN_PROGRESS -> QA -> HUMAN_REVIEW -> DONE
                          ^                       |failure    |issues found
                          |                       v           v
                          +------ BLOCKED    IN_PROGRESS (rework)
                       (human resolves    (QA fail -> Debugger -> IN_PROGRESS,
                        the blocker)              bounded retries)
                                                   |
                                          retries exhausted
                                                   v
                                          FAILED / HUMAN_REVIEW
```

Concrete transition table (event -> from -> to) — matches
`packages/domain/src/task.ts`'s `TASK_TRANSITIONS` exactly:

| From | Event | To |
|---|---|---|
| BACKLOG | task queued for planning | PLANNING |
| PLANNING | architect plan produced | READY |
| PLANNING | architect cannot produce a plan | BLOCKED |
| READY | branch created, developer starts | IN_PROGRESS |
| IN_PROGRESS | developer diff produced | QA |
| QA | tests pass | HUMAN_REVIEW *(future: CODE_REVIEW first — see above)* |
| QA | tests fail, retries remain | IN_PROGRESS (via Debugger) |
| QA | tests fail, retries exhausted | HUMAN_REVIEW |
| HUMAN_REVIEW | human approves | DONE |
| HUMAN_REVIEW | human rejects | IN_PROGRESS or FAILED |
| BLOCKED | human resolves the blocker | PLANNING |
| any non-terminal state | unrecoverable error | FAILED |

`DONE` means merge-eligible with a recorded `Approval` — the system never
merges on its own.

## Agents

**Architect** (strong model, default Claude — configurable). Input: task
description + `ContextPack` (repo structure, relevant files, dependency
summary from Context Engine). Output: structured JSON — plan steps, affected
files, dependencies, acceptance criteria, risks, complexity estimate. This
output *is* the contract the Developer receives; the Developer never sees the
raw task description negotiation, only this artifact.

**Developer** (Claude/Anthropic preferred, configurable via `model-router`).
Input: Architect's plan + acceptance criteria + the specific source files the
plan names (not the repo). Executes in a dedicated git worktree on its own
branch (`ai/<task-id>-<slug>` — see SECURITY.md for why a worktree, not a
checkout in the user's own working directory): edits real files, adds tests
when the plan calls for them. Output: a diff + summary of what changed and
why, mapped back to plan steps.

The plan's named files are the *starting* allocation, not a permanent ceiling.
If the Developer determines it genuinely needs a file the plan didn't name
(e.g. a shared type it must extend, a config it must read), it raises a
**Context Expansion Request** rather than guessing at content or stalling:

```
Developer
  -> emits a ContextExpansionRequest {reason, filesRequested}
     (a structured output artifact, NOT a direct function call — the
     Developer never invokes context-engine or token-intelligence itself)
Orchestrator
  -> Context Engine: relevance analysis over the requested scope
  -> Token Intelligence: estimate additional tokens for the candidate files
  -> Budget check against the Task's remaining TokenBudget headroom
  -> decision: APPROVED / PARTIAL / DENIED, recorded as a ContextExpansionRequest
Orchestrator
  -> if approved (fully or partially): builds an expanded ContextPack and
     resumes the same AgentExecution with it
  -> if denied: Developer continues with the original pack; the denial and
     its reason are recorded and visible in the execution timeline
```

This keeps the Context Engine as the sole authority over *which* files are
relevant — the Developer requests, it does not select — and keeps the same
budget discipline that governs the initial `ContextPack` in force for every
expansion. It is explicitly not a path to requesting the whole repository:
a request that isn't scoped to specific files/areas with a stated reason is
a plan-quality problem to fix in the Architect stage, not something the
Orchestrator should approve. See DOMAIN_MODEL.md for the
`ContextExpansionRequest` record shape.

**QA Engineer**. Runs the project's real test command deterministically (no
LLM) via `git-integration`'s working-tree access; only escalates to an LLM
call to *interpret* a failure (categorize root cause hint for the Debugger)
when tests fail — the pass/fail determination itself is never an LLM
judgment.

**Code Reviewer** (configurable model, defaults to a cheaper capable model).
Input: the diff only, plus acceptance criteria. Reviews for quality,
architecture fit, maintainability, unnecessary complexity. Does not re-read
the whole repo.

**Security Engineer** — same shape as Code Reviewer, focused on
auth/secrets/dependency/config patterns. Not run on every task by default in
the MVP (see below); available to be turned on per task or triggered when the
Architect's plan touches auth/security-tagged files.

**Debugger** (Claude preferred). Input: failing `TestRun` output + the
Developer's diff + Architect's acceptance criteria. Output: a corrective diff
or a structured "root cause + suggested fix" that the Developer applies.
Hands control back to QA; does not re-run the Architect.

**Documentation Agent** — optional, invoked only when the Architect's plan
flags docs as in-scope. Not part of the default MVP pipeline.

## MVP pipeline

The 0.1 default pipeline runs Architect -> Developer -> QA -> (Debugger loop
on failure) -> Code Reviewer -> Human Approval. Security Engineer and
Documentation Agent exist as registered agents with real interfaces but are
opt-in, not invoked automatically yet — this matches "do not make every agent
mandatory for every task" and keeps the MVP's token spend and surface area
proportional to what it needs to prove.

## Model assignment (default, overridable via `model-router` config)

| Agent | Default preference |
|---|---|
| Developer | Claude (strong tier) preferred — it reliably produces fewer errors in real code changes than other connected providers. Phase 20.5: this is a *soft* tier-based preference, not a hard requirement — if a project has no Anthropic credential connected (e.g. BYOK with no funded API account), Developer falls back to another connected provider (e.g. Gemini's free tier — see Phase 22) rather than blocking the task entirely. |
| Debugger | Same preference/fallback rule as Developer. |
| Architect | Strong model, configurable |
| Security Engineer | Strong model, configurable |
| Code Reviewer | Mid-tier model, configurable |
| QA (interpretation only) | Low-cost model, configurable |
| Documentation | Low-cost/local, configurable |
