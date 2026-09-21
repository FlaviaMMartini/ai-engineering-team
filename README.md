# AI Engineering Team

**Make Every Token Count.**

An agentic software engineering platform: you describe a task in plain
language ("build a page with grandma's recipes"), and a small team of
specialized AI agents — Architect, Developer, QA — takes it through a real
Agile-style workflow (plan → implement → test → human review) on a real git
repository, with real branches, real diffs, and a human approval gate before
anything is considered done.

It is not "wire an LLM to write code." The actual point of this project is
the layer *around* the LLM calls: a deterministic orchestrator that decides
what happens next without spending a single token, a context engine that
figures out the minimum slice of a repository an agent actually needs to see,
and a token/cost ledger that can answer, for every task, "why did this cost
what it cost, and could it have cost less without risking correctness?"

## Why this project exists

Most "AI dev tool" demos show a model writing code. The harder, more
interesting problem — and the one this project is actually about — is
everything *around* that call:

- Deciding what happens next in a multi-step workflow **without** asking an
  LLM to decide it (a state machine, not a prompt).
- Giving each agent only the slice of the repository it actually needs,
  instead of "paste the whole repo into the context window."
- Tracking, per task, exactly how many tokens were spent, how many were
  avoided by not sending irrelevant files, and whether the task is on budget.
- Running entirely on a genuinely free LLM tier by default, with automatic
  fallback when that tier hits a rate limit or a transient outage — so
  running this project costs $0 in API spend for anyone trying it.

## What it actually does

```
You submit a task ("build a page with grandma's recipes")
  -> Context Engine scans the repo (no LLM) and picks the relevant slice
  -> Token estimate shown before anything runs
  -> Architect agent turns the task into a structured plan
  -> Developer agent writes real files on an isolated git branch
  -> QA agent runs tests and interprets any failures
  -> Human review gate (nothing merges on its own)
```

Every one of those arrows is a state transition the **Orchestrator**
decides deterministically — never an LLM freelancing about what should
happen next. The Kanban board, the per-task execution timeline, and the
token/cost dashboard are first-class UI, not something bolted on after the
fact.

## How the agents work

Agents never share a conversation — each one gets a purpose-built context
package assembled by the Orchestrator, not the accumulated back-and-forth of
everyone before it.

| Agent | Gets as input | Produces |
|---|---|---|
| **Architect** | The task description + the relevant repo slice (structure, key files, dependencies) | A structured plan: steps, files to touch, acceptance criteria, risks, effort estimate |
| **Developer** | The Architect's plan + acceptance criteria + *only* the specific files the plan names | Real file edits on an isolated git branch/worktree, plus a summary of what changed and why |
| **QA** | The Developer's actual diff (never the Developer's own claims about it) + acceptance criteria | Pass/fail plus a plain-language interpretation of any failures |

If the Developer discovers mid-task that it genuinely needs a file the plan
didn't name, it doesn't guess at the content or silently expand its own
context — it raises a **Context Expansion Request**, a structured artifact
the Orchestrator evaluates against the task's remaining budget (approve in
full, approve partially, or deny with a reason) before ever handing back
control. The Developer never talks to the Context Engine directly; the
Orchestrator mediates every context decision the same way, from the first
allocation to any later expansion.

The design also lays out a **Code Reviewer**, a **Security Engineer**, and a
**Debugger** (bounded-retry loop back to QA on failure) with the same
narrow-input, single-responsibility shape — see [AGENT_DESIGN.md](AGENT_DESIGN.md)
for the full intended pipeline. The current build's state machine implements
the walking-skeleton slice (QA passing goes straight to human review); the
rest is designed and documented, not yet wired into the state machine.

## Orchestration without spending a single token

This is the part that's easy to get wrong in an "agentic" system: letting
the LLM itself decide what step comes next, which means every routing
decision costs tokens and is non-deterministic. This project draws a hard
line instead — **the determinism boundary**:

> Anything that can be computed without an LLM, is.

Concretely, none of the following ever touches a model:

- Reading `package.json`/`tsconfig.json`, scanning the repo's file tree
- Deciding the task's next state (`BACKLOG → PLANNING → READY → IN_PROGRESS
  → QA → HUMAN_REVIEW → DONE`) — a plain finite state machine with an
  explicit transition table, not a prompt
- Running the actual test command and reading its exit code
- Creating the git branch/worktree, computing the diff, committing
- All token/cost arithmetic, budget checks, and relevance scoring
- Choosing which model/provider handles a given agent call (tier-based
  ranking with automatic fallback — see below)

The **Orchestrator** (`packages/orchestrator`) is this dispatcher: look up
the task's current state, ask the (LLM-free) Context Engine for the right
slice of the repo, ask Token Intelligence for a cost estimate against the
budget, ask the Model Router which provider to use, run *one* agent call,
interpret its deterministic result (a diff exists or it doesn't; tests
passed or they didn't), and emit the event that drives the next transition.
The only steps in the entire pipeline that cost tokens are the three actual
agent calls (Architect, Developer, QA) — everything connecting them is
plain, testable, deterministic code.

## How it keeps token cost down

- **Minimal context per agent, not "paste the whole repo."** The Context
  Engine estimates the token cost of the full repository versus the slice it
  actually selected for a given agent call — that difference is tracked and
  shown as "context avoided," not just claimed.
- **A real budget, checked before every call, not after.** Every task has a
  `TokenBudget`; the Orchestrator checks estimated cost against remaining
  budget before spending, not after the fact.
- **A genuinely free execution path by default.** The Model Router ranks
  providers by a soft tier preference — Google's Gemini API (free tier, no
  billing account required) is the default so the whole pipeline runs for
  $0. If you connect a paid provider too (e.g. Anthropic), it's only ever
  preferred for the roles that benefit most from a stronger model, and it's
  never spent unless you explicitly connected it.
- **Automatic fallback instead of failing outright.** LLM calls fail
  sometimes — rate limits, transient overload, a malformed response. Rather
  than failing the whole task on the first hiccup, the runtime retries
  transiently-failed calls (honoring the provider's own "retry after Xs"
  hint when it gives one), and falls through to the next-best ranked model
  if the first one's own retry budget is exhausted — all before ever
  spending a *second* full task retry, which would cost strictly more.
- **Every number is labeled by where it came from.** Estimated tokens are
  ours (a pre-call heuristic); actual input/output tokens are the
  provider's own reported numbers; calculated cost is our arithmetic on top
  of those. Nothing is presented as more precise than it actually is — see
  [TOKEN_ECONOMY.md](TOKEN_ECONOMY.md) for the full accounting model.

## Architecture

A modular monolith — one deployable backend, hard internal package
boundaries, no microservices overhead for a system this size yet:

```
apps/
  web/                 React + TypeScript + Vite frontend (Material UI)
  api/                 Node.js + TypeScript backend (Fastify) — transport only
packages/
  domain/              Shared domain types (Task, AgentExecution, TokenUsage, ...)
  orchestrator/        Deterministic sequencing of the whole workflow
  context-engine/      Repo analysis — no LLM calls, ever
  token-intelligence/  Estimation, usage tracking, cost, budgets
  model-router/        Provider-agnostic model selection + ranked fallback
  providers/           Anthropic / Gemini adapters implementing one LLMProvider interface
  workflow-engine/     The explicit task state machine
  agent-runtime/       Architect / Developer / QA agent implementations
  git-integration/     Isolated git worktree operations (branch/commit/diff)
  persistence/         SQLite repositories, one per aggregate, AES-256-GCM credential encryption
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full dependency graph and the
reasoning behind each boundary, [DOMAIN_MODEL.md](DOMAIN_MODEL.md) for the
data model, and [SECURITY.md](SECURITY.md) for the credential-handling and
git-isolation posture (agents work in a dedicated git worktree, never your
own checked-out working directory).

## BYOK — bring your own key, nothing stored unencrypted

The platform holds no LLM credits of its own. You connect a provider's API
key per project; it's encrypted at rest (AES-256-GCM) before it ever reaches
the database, never logged, never sent to the frontend, and never checked
into this repository. See [SECURITY.md](SECURITY.md).

## Getting started

**Prerequisites:** Node.js 22+, npm.

```bash
git clone <this-repo-url>
cd ai-engineering-team
npm install
```

The API needs one required secret and a couple of optional path overrides:

```bash
# apps/api reads these from the environment — set them in your shell,
# or create apps/api/.env and load it however you prefer.
CREDENTIAL_ENCRYPTION_KEY=<64 hex characters>   # required — see below
AET_DATABASE_PATH=./data/aet-dev.sqlite         # optional, defaults to ./data/aet.sqlite
HTTP_PORT=3000                                   # optional, defaults to 3000
```

Generate a valid encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then, in two terminals:

```bash
npm run dev:api   # backend on http://localhost:3000
npm run dev:web   # frontend on http://localhost:5173
```

Open `http://localhost:5173`, create a project, connect a provider (Google
AI Studio's free Gemini API key needs no billing account — get one at
https://aistudio.google.com/apikey), and submit a task.

### Other useful commands

```bash
npm run typecheck   # full monorepo, project-referenced build
npm test            # full test suite (vitest)
```

## Current status

This is an actively-developed MVP (see [PRODUCT.md](PRODUCT.md) for the
full scope and success criteria). The walking-skeleton pipeline —
Architect → Developer → QA → human review, on a real git repository, with
full token/cost accounting — runs end to end. [ROADMAP.md](ROADMAP.md)
tracks what's next, including the reliability work that came out of testing
this against a real, rate-limited free LLM tier rather than a mocked one.

## License

MIT — see [LICENSE](LICENSE).
