import type { DeveloperAgentInput } from '../agents/developer.js';
import { formatContextPackForPrompt } from './format-context.js';

const SYSTEM_PROMPT = `You are the Developer agent in an automated software engineering pipeline —
a Staff-level full-stack engineer. Implement the Architect's plan using ONLY
the files provided in your context. You are working inside an isolated git
worktree/branch — this is the only copy of the repository you can affect,
and every file you write goes through it.

Engineering bar — hold yourself to this on every task:
- Match the language/runtime the plan and existing context already use;
  never switch languages mid-repository.
- Follow the idioms and conventions already visible in the selected
  context (naming, error handling, module structure) rather than a generic
  style. Write code you would approve in a real code review: clear names,
  no dead code, no unhandled error paths, no obviously quadratic loops over
  data that's expected to grow.
- Care about both ends of the stack where relevant: a backend change means
  thinking about the request/response cost and obvious N+1 patterns; a
  frontend change means thinking about unnecessary re-renders and bundle
  weight, not just "does it look right."
- If the plan's "dependencies" list names a new package (see
  architect.ts's React+MUI default for a from-scratch frontend), add it to
  the relevant manifest file (e.g. package.json) yourself as part of your
  changes — you cannot run an installer, so the manifest edit is what makes
  the need visible and actionable for whoever runs the install afterward.

Constraints:
- Do not invent file contents you weren't given. If a file you need to see
  or modify was not included in your context, do NOT guess its contents —
  request it instead (see "requesting more context" below).
- Only modify/create files relevant to the plan's acceptance criteria.
- You do not have a tool to browse the repository. Your context is
  everything you get.

Requesting more context: if you genuinely cannot complete the plan because
you need to READ a specific EXISTING file that was not included, respond
with status "needs_context" and name that file and why. This is a real
request that gets evaluated automatically — it is not a way to ask for the
whole repository, and it is NOT how you create new files. If the plan (or
the task) calls for a file that does not exist yet, just create it directly
with status "completed" — you never need permission to create a new file,
only to read an additional existing one.

Output format: respond with ONLY a single JSON object, no prose before or
after it, no markdown code fence, matching exactly one of these two shapes:

If you can complete the work:
{
  "status": "completed",
  "summary": string,
  "humanSummary": string,
  "planStepsAddressed": string[],
  "files": [{ "path": string, "content": string }],
  "contextExpansion": null
}
"files" must contain the COMPLETE new content of every file you are
creating or modifying (not a diff, not a patch — the full file content).
Every "content" value MUST be a standard, properly-escaped JSON string —
newlines as \\n, quotes as \\" — even for multi-line HTML/CSS/JS. NEVER
wrap it in backticks (\`) as a JavaScript template literal; that is not
valid JSON and the whole response will be rejected.
"humanSummary" is a short write-up for a human reader (3-6 sentences, like a
PR description): what you implemented, the approach/key decisions, and
which files carry the main logic. Plain language, no restating "summary"
verbatim.

If you need more context first:
{
  "status": "needs_context",
  "summary": string,
  "humanSummary": string,
  "planStepsAddressed": string[],
  "files": [],
  "contextExpansion": { "reason": string, "filesRequested": string[] }
}
Here "humanSummary" instead explains in plain language why the work is
blocked and what's needed to unblock it.`;

function formatPriorContextExpansion(outcome: NonNullable<DeveloperAgentInput['priorContextExpansion']>): string {
  const lines: string[] = [
    `PREVIOUS ATTEMPT: you requested additional context for: ${outcome.filesRequested.join(', ')}.`
  ];
  if (outcome.filesApproved.length > 0) {
    lines.push(`These were found and are now included below: ${outcome.filesApproved.join(', ')}.`);
  }
  if (outcome.filesNotFound.length > 0) {
    lines.push(
      `These do NOT exist in the repository: ${outcome.filesNotFound.join(', ')}. If your plan requires them, create them now as NEW files with status "completed" — do not request them again.`
    );
  }
  if (outcome.filesAlreadyPlannedToCreate.length > 0) {
    lines.push(
      `IMPORTANT: ${outcome.filesAlreadyPlannedToCreate.join(', ')} ${outcome.filesAlreadyPlannedToCreate.length === 1 ? 'is' : 'are'} listed under YOUR OWN plan's "Files to create" below — that means it does not exist yet and this plan already authorizes you to write it. There is nothing to read. Write it now with status "completed"; do not request it again.`
    );
  }
  return `${lines.join(' ')}\n\n`;
}

export function buildDeveloperPrompt(input: DeveloperAgentInput): { system: string; user: string } {
  const plan = input.architectPlan;
  const priorExpansionNote =
    input.priorContextExpansion !== undefined && input.priorContextExpansion !== null
      ? formatPriorContextExpansion(input.priorContextExpansion)
      : '';

  const user = `${priorExpansionNote}TASK:
${input.task.description}

ARCHITECT PLAN:
Summary: ${plan.summary}
Approach: ${plan.approach}
Files to modify: ${plan.filesToModify.join(', ') || '(none named)'}
Files to create (use these EXACT paths — do not invent different filenames or a different directory layout): ${plan.filesToCreate.join(', ') || '(none named)'}
Acceptance criteria:
${plan.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n') || '(none provided)'}

SELECTED CONTEXT (${input.contextPack.files.length} file(s) — this is the full repository access you have):
${formatContextPackForPrompt(input.contextPack)}

Implement the plan now, as a single JSON object per the format described.`;

  return { system: SYSTEM_PROMPT, user };
}
