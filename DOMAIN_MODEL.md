# Domain Model

Types live in `packages/domain/src`. This document is the narrative map; the
TypeScript is the source of truth.

## Aggregates

**Project** — a registered codebase the system can work on. Has one or more
**Repository** records (path or remote URL, default branch, VCS = git).

**Task** — the unit of work a user submits ("Implement JWT auth"). Belongs to
a Project, targets a Repository. Carries a **TokenBudget**, a current
**TaskState**, a working branch name once created, and a `retryCount`.

**TaskState** — the FSM position: `BACKLOG | PLANNING | READY | IN_PROGRESS |
CODE_REVIEW | QA | HUMAN_REVIEW | BLOCKED | FAILED | DONE`. Transitions are
owned by `workflow-engine`, never set directly by agents.

**WorkflowExecution** — one attempt at running a Task through the pipeline.
A Task can have multiple executions if retried from scratch; within an
execution, retries of a single stage increment `retryCount` rather than
creating a new execution. Has an `executionId` used to correlate every event,
request, and cost figure back to "why did *this run* cost what it cost."
Created and advanced exclusively by the **Orchestrator**
(`packages/orchestrator`) — an application-layer module, not part of
`apps/api`. The Orchestrator is the only caller that reads a `TaskState`,
decides the next stage, and asks `workflow-engine` to transition it; `apps/api`
only ever asks the Orchestrator for the current state, it never computes a
transition itself. See ARCHITECTURE.md's "Dependency direction" section.

**Agent** — a role definition (Architect, Developer, QA Engineer, Code
Reviewer, Security Engineer, Debugger, Documentation Agent): name,
responsibilities, default model preference, input/output contract.

**AgentExecution** — one invocation of an Agent within a WorkflowExecution:
which agent, which stage/retry, start/end time, status, references to the
`ContextPack` it received and the `LLMRequest`(s) it made, and its structured
output artifact.

**ContextPack** — the minimal bundle of structured artifacts + source
excerpts assembled for one AgentExecution. Records what was *available*
(files the Context Engine scanned) vs what was *sent* (files actually
included). A ContextPack can grow during an AgentExecution via one or more
approved `ContextExpansionRequest`s (see below) — it is not fixed at
creation time, only at the start of each agent turn.

**ContextExpansionRequest** — raised by an agent (in the MVP pipeline,
Developer) mid-execution when the files it was given are insufficient.
Fields: requesting `AgentExecutionId`, reason (free text from the agent),
`filesRequested`, relevance analysis performed by the Context Engine,
`filesApproved` (may be a subset of requested or empty), `estimatedAdditionalTokens`,
budget impact (headroom before/after), decision (`APPROVED | PARTIAL | DENIED`),
and which `TokenBudget` check produced that decision. The requesting agent
never calls the Context Engine or Token Intelligence directly — the
Orchestrator mediates every expansion exactly as it mediates the initial
`ContextPack`, so the Context Engine remains the sole authority over which
files are relevant. See AGENT_DESIGN.md for the full flow.

**ContextMetric** — deterministic output of the Context Engine for a task:
files scanned, files selected, relevance scores, estimated tokens of the
full repository vs. the selected pack. The metric this feeds,
`estimatedContextAvoided`, is defined and computed in `token-intelligence`
(see TOKEN_ECONOMY.md) as `estimatedFullRepositoryTokens -
estimatedSelectedContextTokens` — a direct subtraction of two estimated
totals, not an average-tokens-per-file projection. It is labeled
**estimated** everywhere it is surfaced, because both terms of the
subtraction come from the MVP's heuristic (character-based) tokenizer, not a
provider-verified count.

**LLMRequest** — one call to a provider: agent, model, provider, prompt
purpose, request/response byte sizes, timestamps, and a **TokenUsage**
record. This is the atomic unit of "we spent tokens here."

**TokenUsage** — the *normalized* usage shape for one LLMRequest:
`inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
totalTokens`. Any field the provider doesn't expose is `null`, never
fabricated. An `LLMRequest` does not store a bare `TokenUsage` in isolation —
it stores:

```
LLMRequest.usage: {
  provider: string
  providerModel: string
  providerReportedUsage: Record<string, unknown> | null   // raw usage block, verbatim
  normalizedUsage: TokenUsage                              // mapped onto the common shape above
}
```

`providerReportedUsage` preserves whatever the provider actually returned
(e.g. Anthropic's `cache_creation_input_tokens` sub-breakdown by TTL tier, if
present) even when it doesn't map cleanly onto `TokenUsage`'s fixed fields.
Nothing in `providerReportedUsage` is invented if the provider omits it —
absent fields stay absent (`undefined`), not zero. This exists so a
provider-specific metric is never discarded just because the normalized
schema has no field for it; `normalizedUsage` stays the cross-provider
contract everything else in the system (budgets, cost, narration) reads from.

**TokenBudget** — per-task configured ceiling (tokens and/or cost), plus
running `estimatedUsage` (computed before execution) and `actualUsage`
(accumulated from `normalizedUsage` on LLMRequests as they complete).

**TokenCost** — derived from `TokenUsage` + a versioned pricing entry:
`estimatedCost`, **`calculatedCost`** (previously named `actualCost` — see
TOKEN_ECONOMY.md for why), currency, and `pricingVersion` (the identifier of
the exact pricing table row/version used, persisted alongside the cost
figure so a later pricing-table update never silently rewrites the meaning
of a historical cost). Pricing tables are static config, versioned, never
invented at runtime. "Calculated" is the deliberate word here: no provider
API returns a billed dollar amount, so this figure is always our own
arithmetic over provider-reported tokens, and the UI must label it as such
(see TOKEN_ECONOMY.md, "Provider-reported vs. calculated").

**GitOperation** — an audit record of a git action taken on behalf of a task
(branch create, commit, diff) — operation, args, result, timestamp. Push/merge
are recorded the same way but only ever originate from an explicit user
action, never automatically.

**TestRun** — deterministic output of executing the project's test command:
command, exit code, pass/fail counts, raw output pointer, duration. Never an
LLM guess about whether tests passed.

**Review** — Code Reviewer / Security Engineer output: findings list
(severity, file, line, description), verdict.

**Approval** — the human gate: who approved, when, what diff/executionId it
was approved against. A Task cannot reach `DONE` (merge-eligible) without one.

**ProviderCredential** — BYOK credential record: provider, encrypted key
material, owner, created/rotated timestamps. Never the raw key in any log or
API response.

## Why this shape

Every cost and correctness question the product needs to answer is a query
over this graph: `Task -> WorkflowExecution -> AgentExecution -> LLMRequest ->
TokenUsage/TokenCost`, joined against `ContextPack`/`ContextMetric`/
`ContextExpansionRequest` for "what did we send, avoid, or add mid-execution,"
and against `TestRun`/`Review`/`Approval` for "did it actually work and did a
human sign off." Nothing about token/cost analytics requires a separate
reporting pipeline — it's a read model over these tables. All of this is
assembled by the **Orchestrator** (`packages/orchestrator`), which is the
only module that writes `WorkflowExecution`/`AgentExecution`/
`ContextExpansionRequest` records — `apps/api` only reads them back for
display.
