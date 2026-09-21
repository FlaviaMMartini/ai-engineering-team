# AI Engineering Team

**Tagline:** Make Every Token Count.

## What this is

An agentic software engineering platform. A user submits a task ("Implement JWT
authentication in project X") and a team of specialized AI agents resolves it
through a real Agile workflow: architecture → implementation → QA → review →
human approval. The system is git-native (real branches, real diffs, real
commits) and treats human approval before merge as non-negotiable.

## The differentiator

Not "multi-agent AI." **Intelligent orchestration + context optimization +
token economy.** Any team can wire an LLM to write code. The thing worth
building is a system that can answer, for every dollar and every token it
spends:

- Why did this cost what it cost?
- Could it have cost less without risking correctness?
- What context did we avoid sending, and what did that save?
- Are we on budget, and if not, why?

Correctness comes before token minimization, always. Token efficiency is a
constraint the orchestrator optimizes under, not a goal it trades correctness
against. A cheap execution that fails and retries three times is worse — in
tokens *and* dollars — than one well-contextualized execution the first time.

## MVP scope (0.1)

The MVP proves one thing: the full loop works, end to end, on a real
repository, with real token/cost accounting at every step.

```
Task created (repo + budget)
  -> Context Engine (deterministic repo analysis, no LLM)
  -> Token estimate shown to user
  -> Architect agent (Claude) -> structured plan
  -> Developer agent (Claude) -> real file edits on a git branch
  -> QA agent (deterministic test run, LLM only to interpret failures)
  -> on failure: Debugger agent -> back to QA (bounded retries)
  -> Code Review (lightweight LLM pass)
  -> Human approval gate (no auto-merge)
  -> Done
```

The first implementation slice (the "0.1a walking skeleton") proves this
loop without the Code Review step — QA passing goes straight to human
approval — and Code Review is layered on once that skeleton works end to
end. See AGENT_DESIGN.md's "0.1a vs. future" note.

Kanban board + task detail execution timeline + Token Intelligence dashboard
are first-class UI, not an afterthought bolted on later.

Explicitly deferred past 0.1: vector/semantic search, distributed workers,
multi-tenant IAM, autonomous merge, multi-provider routing beyond the
interface existing, complex billing. See [ROADMAP.md](ROADMAP.md).

## Success criteria

See the "SUCCESS CRITERIA FOR MVP 0.1" checklist carried over from the
original product brief — functionally: a user can create a task against a
real repo, watch it move through the kanban, see which agent is active, see
token estimates before and actual usage after, see budget utilization and
context avoided, review the resulting diff, and approve merge — or see
exactly why it's blocked/failed if it isn't ready.
