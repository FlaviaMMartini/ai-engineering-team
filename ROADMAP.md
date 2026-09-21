# Roadmap

## 0.1 — Core loop (this build)

Task creation -> Context Engine -> token estimate -> Architect -> Developer
(Claude) -> QA -> bounded Debugger retries -> Code Review -> human approval
gate. Kanban + task detail timeline + Token Intelligence dashboard. SQLite
persistence, local git branch/commit, BYOK Anthropic credential. See
PRODUCT.md for the full success-criteria checklist.

The first implementation slice within 0.1 (the "0.1a walking skeleton") ships
without Code Review — QA passing goes straight to human approval. Code
Review is added on top of the working skeleton, still within 0.1, once the
core loop is proven end to end. See AGENT_DESIGN.md's "0.1a vs. future" note
for the exact state-machine difference.

## 0.1b — Free execution: Ollama tried, replaced by Gemini — moved up from 0.4

**Reprioritized after live BYOK testing surfaced a real adoption blocker:**
a typical developer has a Claude/ChatGPT *subscription* (Pro/Max, Plus) but
no separate, funded Developer API account — subscription usage and
pay-per-token API billing are different products with different billing,
even at the same vendor. Requiring a funded API key before a user can run
a single task contradicts "Make Every Token Count": the platform should be
usable with $0 of API spend.

**First attempt: Ollama (local runtime), removed after live testing.** A
full `LLMProvider` adapter was built and shipped, running `qwen2.5-
coder:7b` on consumer hardware (no dedicated GPU, ~16GB RAM). Real
end-to-end runs surfaced two compounding problems: (1) a 7B model at that
quantization frequently couldn't complete even modest tasks reliably —
malformed JSON output (writing a JS template literal instead of an
escaped JSON string), requesting files that don't exist, plans that
hallucinated a framework the repository never used; (2) local inference
competed with the rest of the app for the same machine's CPU/RAM,
compounding the Windows/better-sqlite3 native-module instability already
being worked around elsewhere. The adapter code, BYOK wiring, and its
model-selection tier all worked exactly as designed — the blocker was
model capability and local resource contention, not the integration
itself. Given free cloud alternatives exist with no such cost, Ollama was
removed rather than kept as a second free path to maintain.

**Replaced with Gemini (Google's Generative Language API):**
- Gemini adapter (`packages/providers/src/gemini/`), implementing the same
  `LLMProvider` interface Anthropic already implements — no changes to
  Agent Runtime, Orchestrator, or Model Router's public contracts. Uses
  Google AI Studio's genuinely free API key tier (no billing account
  required), defaulting to `gemini-3.6-flash`.
- `ProviderName` (domain) is `'anthropic' | 'gemini'`; BYOK connects Gemini
  like any other provider — a real encrypted API key through the same
  `CredentialStore`/`ProjectProviderConfiguration` lifecycle, no
  special-casing needed (unlike Ollama's local-daemon-URL connection,
  which this replaces).
- **Model Router policy stays exactly as designed: Claude remains the
  preferred choice for the Developer agent when a connected, funded
  Anthropic credential exists** — Gemini is an availability fallback for
  projects with no paid provider connected (`tier: 'mid'` vs Anthropic's
  `tier: 'strong'`), not a quality-based default. Anthropic still wins
  whenever both are connected; Gemini exists so the platform has a genuine
  $0 path that doesn't depend on the user's own hardware.
- Token Intelligence keeps recording estimated/actual usage the same way
  for Gemini calls — "tokens consumed" stays meaningful even when
  `calculated cost` is `$0` on a free tier, which is itself a good
  demonstration of "every token counted, not every token billed."

### 0.1b.1 — Gemini reliability round + cross-provider fallback

Live end-to-end testing against the real Gemini API surfaced a chain of
real bugs, each masking the next until fixed — a task couldn't reach QA at
all until all of these landed:
- **The actual "task stuck forever with no error" bug**: `worktreeRoot`
  was a relative path (`./data/worktrees`), and `git worktree add` (which
  runs with its cwd bound to the *repository's* directory) resolved that
  relative path completely differently from `AiWorktree`'s own git binding
  (which resolves relative to the Node process's cwd) — git created the
  worktree in one real location, the app looked for it in another, and
  failed with "directory does not exist" right after the task had already
  moved to READY, a state with no automatic path back to FAILED. Fixed by
  resolving `worktreeRoot` to an absolute path once, in `GitRepository.open()`
  (packages/git-integration), and by adding an orchestrator-level safety
  net so any future failure between two state transitions still marks the
  task FAILED with a real reason instead of leaving it stuck silently.
- **`AgentExecution.errorMessage`**: a failed agent execution's real error
  used to exist only in the one-shot HTTP response of the original execute
  call — polling afterward saw a bare "FAILED" chip with zero explanation.
  Now persisted end-to-end (domain -> persistence -> read model -> HTTP DTO
  -> `AgentExecutionCard`'s error alert).
- **Generic provider-error messages discarded the real cause**:
  `LLMProviderUnavailableError`/`LLMAuthenticationError`/`LLMTimeoutError`/etc.
  built their `.message` from a template alone and threw away the actual
  HTTP status/vendor text/network error name into `cause`, where nothing
  ever read it. Every one of these now includes that detail.
- **`AgentExecutionError.retryable` was set but never read**: a transient
  provider hiccup (rate limit, momentary 503, timeout) failed the whole
  task on the first try even though the flag existed specifically to mean
  "retry this." `invokeLLM` (packages/agent-runtime) now retries
  transparently — network errors and malformed-output parse failures alike,
  since an LLM's bad JSON on one attempt is not meaningfully different from
  a 503: both are worth one more roll of the dice. Rate limits get their
  own larger time *budget* (not attempt count) because Gemini's own
  `google.rpc.RetryInfo` tells us precisely how long is left, so guessing
  isn't necessary the way it is for a 503/timeout.
- **Gemini wasn't in JSON mode at all**, and its "thinking" tokens draw
  from the same `maxOutputTokens` ceiling as the visible response — caught
  live when the Developer's call reported `finishReason: max_tokens` after
  writing only ~1.3KB of visible text against an 8000-token budget, having
  spent nearly all of it thinking. Fixed with `responseMimeType:
  'application/json'` and `thinkingConfig.thinkingBudget: 0` — every agent
  role here wants one deterministic structured document, not a reasoning
  trace.
- **`ModelSelectionResult.fallbacks` existed but nothing read it**:
  Model Router already ranked every other eligible, connected candidate for
  exactly this purpose ("in case the caller's actual provider call fails
  and it wants to retry with the next one — model-router never performs
  that retry itself"), but `invokeLLM` only ever tried the top pick. It now
  falls through the ranked list when a candidate's own retry budget is
  exhausted. This never reaches for a provider the project hasn't
  connected — a Gemini-only project still has an empty fallback list and
  behaves exactly as before; a connected-but-costlier provider (e.g.
  Anthropic) only ever becomes a candidate because the user explicitly
  connected it, never as a silent, unrequested spend.
- **A same-provider fallback model, requiring no new signup at all**: a
  Gemini connection's catalog now includes `gemini-3.5-flash-lite` as a
  second, `tier: 'low_cost'` candidate alongside the primary `gemini-3.6-
  flash` entry (`buildGeminiFallbackCatalogEntry` in composition-root.ts) —
  the SAME credential, the SAME `LLMProvider` instance, just a different
  model name per call. Caught live: `gemini-3.6-flash` returning "HTTP 503:
  this model is currently experiencing high demand" is a capacity problem
  specific to that one model's own serving pool, not to the user's key or
  to Gemini generally — a different model is very likely on separate
  capacity. This gives the fallback mechanism above something real to use
  for every Gemini-only project immediately, without asking the user to
  connect a second, possibly-paid provider just to get resilience against
  one model's momentary overload.

### 0.1c — Beyond one hardcoded free model (not yet built)

Today's Gemini integration hardcodes one model name
(`GEMINI_MODEL`/`gemini-3.6-flash`) as the only thing a project's Gemini
connection can run. Planned, in rough order:
- Let a project's Gemini connection name **which** model to use (a
  per-project setting, not one global env var) — Google offers multiple
  Gemini variants (Flash, Flash-Lite, Pro) with different speed/quality/
  free-tier-limit trade-offs; that choice is the user's to make, not this
  codebase's.
- A free-text "suggest a model" field for anything not already listed: the
  UI accepts the name, the backend attempts to use it, and surfaces a
  clear error if the vendor doesn't recognize it — this is the "user can
  suggest an LLM not in the list" ask, generalized beyond just Gemini.
- Evaluate additional **zero-cost cloud** adapters alongside Gemini (e.g.
  Groq's hosted open-weight models) — these would plug in as ordinary new
  `LLMProvider` implementations exactly like Anthropic/Gemini did, no
  architectural change needed. Each such provider needs its own research
  pass (real free-tier limits change; nothing gets hardcoded here without
  verifying it against the vendor's current terms first).
- Re-evaluate a **local** option (Ollama or similar) as an opt-in choice
  for users with strong-enough hardware (dedicated GPU, more RAM) once the
  quality/reliability bar is worth the local resource cost for them
  specifically — not as the default free path, which Gemini now owns.
- Model Router's tier-based preference (see above) is what decides among
  *connected* providers — none of this changes that policy, it only grows
  the set of things a project can legitimately connect.

## 0.2 — Round out the team

- Security Engineer wired in automatically when the Architect's plan touches
  auth/secrets/config files.
- Documentation Agent wired in when the plan flags docs as in-scope.
- Push-to-remote and PR-creation as an explicit, separate user action
  (GitHub API integration) — still no auto-merge.
- Reviewer/QA feedback loop: CODE_REVIEW requesting changes routes back to
  Developer with the reviewer's findings as structured input.

## 0.3 — Context Engine depth

- AST-based symbol extraction (start with TS/JS via `ts-morph`) instead of
  text/grep heuristics.
- Import/export dependency graph for more precise "affected files."
- Git history-aware relevance (files that changed together historically rank
  higher for related tasks).
- Context compression (summarize large files instead of excerpting/omitting).

## 0.4 — Model router maturity

- OpenAI adapter implemented (Ollama moved to 0.1b — see above; this phase
  is now specifically the second *paid* provider, completing real
  multi-provider routing beyond the provider-agnostic design that already
  exists from 0.1).
- Router considers live latency/availability, not just static preference.
- Per-project model policy overrides.

## 0.5 — Multi-task orchestration

- Concurrent task execution with shared budget pools across a project.
- Cross-task context reuse (two tasks touching the same module share a
  Context Engine pass).

## Explicitly not planned near-term

Semantic/vector search infrastructure or an embeddings store (until
deterministic + AST-based relevance is proven insufficient), a queue/broker
(Redis or otherwise — the MVP has one task executing through one pipeline at
a time; nothing yet requires cross-process job distribution), Kubernetes/
distributed workers, microservice extraction, autonomous merge, enterprise
IAM/multi-tenancy, complex usage-based billing, and multi-provider routing
logic beyond the `LLMProvider` interface already existing (see 0.1b for the
second real adapter — Gemini's free tier, brought forward — and 0.4 for the
second paid one, OpenAI). Each of these adds real infrastructure cost and none are
required to prove the product thesis; revisit only when the 0.1–0.4 loop is
in real use and hitting a concrete wall one of these would solve.
