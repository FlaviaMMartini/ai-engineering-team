# Token Economy

## Principle

Minimize unnecessary tokens while preserving correctness. Optimize **total
execution cost**, not raw token count — a cheap model that fails and retries
three times costs more, in tokens and wall-clock, than one well-contextualized
call to a stronger model. The Token Economy Engine's job is to make that
trade-off visible and, where safe, automatic.

## No composite score in MVP 0.1

MVP 0.1 does **not** define a single "Token Efficiency Score." A composite
index collapses several independent, differently-shaped numbers (a ratio, a
count, a percentage, a dollar figure) into one score, and there is no real
execution data yet to validate what weighting of those numbers would actually
predict anything useful. Inventing a formula now would be a made-up number
wearing a rigorous-looking label — exactly what TOKEN_ECONOMY.md's other
sections explicitly refuse to do for individual metrics.

Instead, MVP 0.1 exposes the following **independent, individually-labeled
metrics**. Each is defined precisely below, each is surfaced separately in
the UI, and none is blended into a single score:

- estimated tokens
- actual input tokens
- actual output tokens
- cached input tokens
- budget utilization
- calculated cost
- estimate variance
- context avoided (estimated)
- retry overhead
- context expansion
- cache hit rate (when the provider supports caching)

A composite **Token Efficiency Index** is explicitly deferred — see
"Deferred: composite index" at the end of this document.

## Provenance: provider-reported vs. calculated by us

This is the single most important distinction in this document, and it must
be visible in the UI as a literal label on every figure, not just documented
here:

| Value | Who produces it |
|---|---|
| Estimated tokens | **Us** — heuristic, pre-call, never an LLM call |
| Actual input tokens | **Provider-reported**, verbatim |
| Actual output tokens | **Provider-reported**, verbatim |
| Cached input tokens | **Provider-reported**, verbatim (`null` if the provider doesn't expose it) |
| Budget utilization | **Us** — arithmetic over the above |
| Calculated cost | **Us** — provider tokens x our versioned pricing config |
| Estimate variance | **Us** — arithmetic (actual vs. estimated) |
| Context avoided | **Us** — arithmetic over two of our own estimates |
| Retry overhead | **Us** — aggregation over LLMRequests we already recorded |
| Context expansion | **Us** — recorded at the moment the Orchestrator approves/denies a request |
| Cache hit rate | **Us**, but computed *entirely* from provider-reported cache token counts — we do no estimation here |

No provider (Anthropic included) returns a dollar amount or an efficiency
score. Every dollar or ratio figure in this system is our own arithmetic on
top of a small number of provider-reported token counts.

## The metrics, defined

### Estimated tokens

Computed *before* an LLM call from the assembled `ContextPack` size using a
character-based heuristic (`packages/token-intelligence/src/estimate.ts`),
clearly labeled as an estimate everywhere it's surfaced. Deliberately
conservative and cheap to compute — it must never itself require an LLM call.

### Actual input tokens / actual output tokens / cached input tokens

Taken verbatim from the provider's response usage block. For Anthropic:
`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`. If a provider doesn't expose a field, it is stored
as `null` — never backfilled with a guess. These map onto `LLMRequest.usage
.normalizedUsage` (see DOMAIN_MODEL.md); the provider's raw usage block is
preserved separately as `providerReportedUsage` so a provider-specific figure
that doesn't fit the normalized shape is never discarded (see "Provider raw
telemetry" below).

### Budget utilization

`(actualUsage.totalTokens ?? estimatedUsage.totalTokens) / budget.maxTokens`.
`null` when no `maxTokens` ceiling is configured — utilization against an
unset budget is not "0%," it's undefined, and the UI must render it that way.

### Calculated cost (not "actual cost")

Renamed from "actual cost" in earlier drafts of this document. No provider
API returns a final billed dollar amount — Anthropic's response gives token
counts only. "Actual cost" implied a figure confirmed by the provider; it
never is. **Calculated cost** is:

```
calculatedCost = f(normalizedUsage, pricingTable[pricingVersion])
```

i.e. provider-reported token usage (input, output, and cache tiers where
priced differently) run through our own versioned pricing configuration.
`TokenCost` persists the `pricingVersion` used at calculation time (see
DOMAIN_MODEL.md) specifically so that a later pricing-table update never
silently changes what a historical execution's cost figure means — you can
always ask "what was this calculated with."

**UI requirement:** every place a cost or usage figure is shown, it is
labeled either "Provider-reported" (the four raw token counts) or
"Calculated by AI Engineering Team" (everything derived from them — cost,
budget utilization, context avoided, estimate variance, retry overhead,
context expansion, cache hit rate). This is not cosmetic — conflating the two
is exactly the kind of imprecision this document exists to prevent.

### Estimate variance

New in this revision. `(actualUsage.totalTokens - estimatedUsage.totalTokens)
/ estimatedUsage.totalTokens`, per stage and cumulative per task. This is the
metric that tells us whether the character-based heuristic estimator is any
good — high variance, consistently in one direction, is the signal that the
heuristic (not the product's usage) needs improving. Without this metric,
"estimated tokens" is just a number nobody checks against reality.

### Context avoided (estimated)

```
estimatedContextAvoided =
    estimatedFullRepositoryTokens - estimatedSelectedContextTokens
```

Both terms are the Context Engine's own heuristic estimate — the full-repo
figure is *not* `filesScanned x averageTokensPerFile`. Average-tokens-per-file
is a proxy that breaks the moment file sizes are non-uniform (a single large
generated file would distort the whole repo's estimate); the actual meaning
of this metric is always the direct subtraction above, computed by running
the same estimator over the full scanned set and over the selected set. The
implementation may still estimate each file's token count with a cheap
per-file heuristic internally — that's an implementation detail of how
`estimatedFullRepositoryTokens` and `estimatedSelectedContextTokens` are each
computed — but the *conceptual definition* of the metric is the subtraction,
not an average.

This is labeled **"context avoided (estimated)"**, never bare "context
avoided," everywhere it's surfaced in MVP 0.1, because the tokenizer behind
both terms is a heuristic, not the provider's actual tokenizer. If a future
version swaps in a provider-accurate tokenizer, the label can drop
"(estimated)" — but only then.

### Retry overhead

Every retry (QA failure -> Debugger -> QA again) is its own `AgentExecution`
with its own `LLMRequest`s. Retry overhead sums these explicitly: "retries
added ~X tokens / calculated $Y" reported separately from the primary-path
total, not folded invisibly into one number. This is one of the product's
signature messages ("QA failed once, adding approximately 12k tokens to the
execution") and it must always be phrased as an addition on top of the base
execution, never blended into a single number that hides how much retries
cost.

### Context expansion

New in this revision, paired with the Context Expansion flow (see
AGENT_DESIGN.md and DOMAIN_MODEL.md's `ContextExpansionRequest`). Per task:
count of expansion requests raised, how many were approved/partial/denied,
and `estimatedAdditionalTokens` summed across approved requests. This is
tracked as its own line, separate from the original `ContextPack` estimate,
so "how much context did the Developer end up needing beyond the Architect's
plan" is a visible, honest number rather than silently inflating the
original estimate after the fact.

### Cache hit rate (when supported)

When a provider supports prompt caching (Anthropic does, via `cache_control`
breakpoints on stable prefix content), `cacheReadTokens /
(cacheReadTokens + inputTokens)` for a request or execution, computed only
from provider-reported cache counts — no estimation involved. **No cache
metric of any kind is shown unless the provider actually reported a cache
read for that request.** A task that used no caching shows no cache-related
figures at all, not a "0%" that implies caching was attempted and failed.

## Budget model

Each Task has a `TokenBudget` (token ceiling, optionally a cost ceiling). The
Orchestrator computes `estimatedUsage` before each expensive stage and checks
it against the budget:

```
if estimatedUsage_so_far + estimatedUsage_next_stage > budget.tokens:
    1. try shrinking the ContextPack (drop lowest-relevance-score files)
    2. if still over, pause and raise HUMAN_REVIEW with the shortfall shown
```

The system never silently exceeds a configured budget and never claims
insight into a *provider* quota it doesn't have. UI language distinguishes
strictly:

- "configured task budget" — the number the user set
- "estimated task usage" — model of what this run will cost
- "actual task usage" — provider-reported token totals as they accumulate
- "calculated task cost" — our arithmetic over actual task usage (never
  "actual cost" — see above)
- provider account quota — only shown if the provider API actually exposes it
  (as of MVP, none of the supported adapters do, so this is not shown)

Note: an earlier draft of this section listed a third over-budget lever,
"downgrade model." That step is removed here because it presumes a working
multi-model/multi-provider router, which is explicitly out of scope until
ROADMAP.md's 0.4 (model router maturity). Until a second model tier actually
exists to downgrade to, that branch has nothing to do and is not implemented.
Re-add it when 0.4 lands a real second option.

## Provider raw telemetry

The normalized `TokenUsage` shape (`inputTokens, outputTokens,
cacheCreationTokens, cacheReadTokens, totalTokens`) is required for every
cross-provider computation in this document — budgets, cost, variance, cache
hit rate all read from it. But it is not the only thing stored per
`LLMRequest`. Each request's usage is stored as:

```
provider              e.g. "anthropic"
providerModel          e.g. "claude-sonnet-5"
providerReportedUsage  the raw usage object exactly as returned, or null
normalizedUsage        the TokenUsage shape above, mapped from the raw object
```

`providerReportedUsage` exists so that a provider-specific detail that
doesn't fit `TokenUsage`'s fixed fields (for example, a per-TTL-tier
breakdown of cache creation tokens) is preserved rather than thrown away at
the normalization boundary. Fields the provider doesn't return stay absent —
never zero-filled, never guessed. See DOMAIN_MODEL.md for the full shape.

## Cache savings

When a provider supports prompt caching, `model-router`/`providers/anthropic`
marks cacheable segments and the actual `cache_read_input_tokens` returned by
the API is the source of truth for the cache hit rate metric above. Prompt
caching itself (marking `cache_control` breakpoints) is a later optimization,
not part of the MVP 0.1 walking skeleton — see the architecture review's
overengineering check — but the metric definition and the "provider-reported
only, never estimated" rule for cache figures apply from day one, so the
narration layer never has to be rewritten once caching is actually turned on.

## Model selection as a cost lever

`model-router` chooses model per (agent, task complexity, context size,
budget headroom) per the defaults in AGENT_DESIGN.md. In MVP 0.1 there is
exactly one provider and one model tier configured per agent role, so this
selection is a fixed lookup, not a rules engine — see the architecture
review's overengineering check for why a routing engine is deferred.
Complexity comes from the Architect's own structured output
(`complexityEstimate`), a deterministic-ish classification the Architect is
asked to produce explicitly, not inferred by guesswork elsewhere.

## Human-readable translation layer

`packages/token-intelligence/src/narrate.ts` turns the metrics above into the
sentences the product is built around ("Context optimization avoided
approximately 120k tokens (estimated)", "38% of input context was served
from cache"). Every sentence template pulls its numbers from a real computed
value and states plainly whether that value is provider-reported or
calculated by us; there is no path that renders a narrative sentence from a
placeholder or made-up figure. If a metric is unavailable (e.g. no cache used
this run), its sentence is simply omitted rather than shown with a zero that
implies measurement occurred. `narrate.ts` composes the individual metrics
above into sentences — it does not compute or expose a composite score (see
below).

## Deferred: composite index

A single "Token Efficiency Index" — some weighted blend of estimate
accuracy, retry overhead, context avoided, and cache hit rate — is a
plausible future feature, but building it now means guessing at weights with
zero real executions to validate them against. It is explicitly deferred
until MVP 0.1 has run enough real tasks that the individual metrics above
have observed ranges and known failure modes. When revisited, it should be
derived from the metrics already defined here, not from new raw data — if a
new number is needed to compute it, that is a sign the individual metrics
above are incomplete, and that gap should be fixed first, on its own.
