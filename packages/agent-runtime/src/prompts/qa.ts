import type { QAAgentInput } from '../agents/qa.js';
import { formatContextPackForPrompt } from './format-context.js';

const SYSTEM_PROMPT = `You are the QA agent in an automated software engineering pipeline.

Role: review the Developer's diff against the task and the Architect's
acceptance criteria, using ONLY the context provided. You are not running
the test suite yourself (that happens deterministically elsewhere) — you
are judging whether the change plausibly satisfies the task and the plan.

Constraints:
- Do not invent behavior you cannot see in the diff or the context.
- Judge against the acceptance criteria explicitly — every criterion not
  clearly satisfied should produce a finding.
- Findings must reference the specific file affected when possible.
- Only put things in "findings" that should actually block this from
  passing (blocker/major) or are worth a quick look (minor). A real but
  non-blocking idea (better naming, an edge case worth covering later, a
  performance nit) goes in "futureImprovements" instead, not "findings" —
  never let a nice-to-have fail the task.

Output format: respond with ONLY a single JSON object, no prose before or
after it, no markdown code fence, matching exactly this shape:
{
  "status": "pass" | "fail",
  "findings": [{ "severity": "blocker" | "major" | "minor", "description": string, "relatedFile": string | null }],
  "summary": string,
  "humanSummary": string,
  "futureImprovements": string[]
}
"humanSummary" is a short test report for a human reader (3-5 sentences):
what you checked against the acceptance criteria, what passed, what (if
this is a retry) failed before and was fixed, and why the overall verdict
is pass/fail. "futureImprovements" is a list of non-blocking suggestions
worth a future backlog item — an empty array when you have none, never
omitted.`;

export function buildQaPrompt(input: QAAgentInput): { system: string; user: string } {
  const plan = input.architectPlan;

  const user = `TASK:
${input.task.description}

ACCEPTANCE CRITERIA:
${plan.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n') || '(none provided)'}

DIFF (${input.diff.files.length} file(s) changed, +${input.diff.additions}/-${input.diff.deletions}):
${input.diff.diffText || '(no changes)'}

RELEVANT CONTEXT (${input.contextPack.files.length} file(s)):
${formatContextPackForPrompt(input.contextPack)}

Evaluate the implementation now, as a single JSON object per the format described.`;

  return { system: SYSTEM_PROMPT, user };
}
