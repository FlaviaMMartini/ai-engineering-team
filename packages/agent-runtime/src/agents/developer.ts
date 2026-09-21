import type { AiWorktree, GitDiff } from '@aet/git-integration';
import type { ModelRouter } from '@aet/model-router';
import type { TokenEstimator } from '@aet/token-intelligence';
import { invokeLLM } from '../execution.js';
import { makeAgentExecutionError } from '../errors.js';
import { buildDeveloperPrompt } from '../prompts/developer.js';
import type { Agent, AgentInput, AgentResult, ContextExpansionProposal, LLMExecutorRegistry } from '../types.js';
import type { ArchitectPlan } from './architect.js';

/**
 * Raised from 4000 after live testing: a multi-file plan (e.g. separate
 * .html/.css/.ts files, each with full content, as JSON-escaped strings)
 * can genuinely need more than 4000 output tokens, and a response cut off
 * mid-JSON by hitting this cap is indistinguishable from a genuinely
 * malformed one — it fails to parse either way. Both catalog entries this
 * codebase ships today (Anthropic and Gemini, see composition-root.ts) list
 * outputLimit: 8192, so this stays safely under either.
 */
const EXPECTED_OUTPUT_TOKENS = 8000;

/**
 * What the Orchestrator decided about a PREVIOUS `needs_context` response
 * from this same Developer, on a retry after that decision (see
 * orchestrator's context-expansion.ts). Null on a first attempt. Distinct
 * from `AgentInput.contextPack` itself (which already carries any approved
 * files' actual content) — this only carries the explanation, so the
 * Developer understands what happened to its request rather than silently
 * receiving a bigger context pack with no comment.
 */
export interface PriorContextExpansionOutcome {
  filesRequested: readonly string[];
  filesApproved: readonly string[];
  filesNotFound: readonly string[];
  /** Requested paths that YOUR OWN plan already lists under filesToCreate — see prompts/developer.ts's pointed callout for these. */
  filesAlreadyPlannedToCreate: readonly string[];
}

export interface DeveloperAgentInput extends AgentInput {
  architectPlan: ArchitectPlan;
  /**
   * The isolated git worktree this task is running in (see git-integration's
   * Phase 3). The Developer never touches the user's own working tree —
   * every write goes through this handle, which already enforces
   * containment/symlink safety on every path.
   */
  worktree: AiWorktree;
  priorContextExpansion?: PriorContextExpansionOutcome | null;
}

export type DeveloperOutputStatus = 'completed' | 'needs_context';

export interface DeveloperOutput {
  status: DeveloperOutputStatus;
  summary: string;
  /**
   * A short write-up for a human reader — what was implemented and how,
   * like a mini PR description/README excerpt: key files touched, the
   * approach taken, anything a reviewer should know. Distinct from
   * `summary` (a terse one-liner used elsewhere in the pipeline). On
   * 'needs_context', this instead explains in plain terms why the work
   * couldn't proceed yet.
   */
  humanSummary: string;
  planStepsAddressed: readonly string[];
  filesChanged: readonly string[];
  /** Null when status is 'needs_context' — nothing was written yet. Always the REAL diff from git-integration, never the LLM's self-reported claim of what changed. */
  diff: GitDiff | null;
  /** Non-null only when status is 'needs_context'. See types.ts's ContextExpansionProposal for why this isn't domain's ContextExpansionRequest. */
  contextExpansionProposal: ContextExpansionProposal | null;
}

interface DeveloperLLMFileWrite {
  path: string;
  content: string;
}

interface DeveloperLLMOutput {
  status: DeveloperOutputStatus;
  summary: string;
  humanSummary: string;
  planStepsAddressed: string[];
  files: DeveloperLLMFileWrite[];
  contextExpansion: { reason: string; filesRequested: string[] } | null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isFileWriteArray(value: unknown): value is DeveloperLLMFileWrite[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry): entry is DeveloperLLMFileWrite =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).path === 'string' &&
        typeof (entry as Record<string, unknown>).content === 'string'
    )
  );
}

/** Structural validation of our own JSON contract — not a schema library, deliberately small. */
function parseDeveloperLLMOutput(text: string): DeveloperLLMOutput {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Developer output is not a JSON object');
  }
  const candidate = parsed as Record<string, unknown>;

  if (candidate.status !== 'completed' && candidate.status !== 'needs_context') {
    throw new Error('Developer output has an invalid status');
  }
  if (
    typeof candidate.summary !== 'string' ||
    typeof candidate.humanSummary !== 'string' ||
    !isStringArray(candidate.planStepsAddressed)
  ) {
    throw new Error('Developer output is missing required fields (summary, humanSummary, planStepsAddressed)');
  }

  if (candidate.status === 'completed') {
    if (!isFileWriteArray(candidate.files)) {
      throw new Error('Developer output with status "completed" must include a valid files[] array');
    }
    return {
      status: 'completed',
      summary: candidate.summary,
      humanSummary: candidate.humanSummary,
      planStepsAddressed: candidate.planStepsAddressed,
      files: candidate.files,
      contextExpansion: null
    };
  }

  const expansion = candidate.contextExpansion as Record<string, unknown> | null | undefined;
  if (
    typeof expansion !== 'object' ||
    expansion === null ||
    typeof expansion.reason !== 'string' ||
    !isStringArray(expansion.filesRequested) ||
    expansion.filesRequested.length === 0
  ) {
    throw new Error('Developer output with status "needs_context" must include a valid contextExpansion object');
  }

  return {
    status: 'needs_context',
    summary: candidate.summary,
    humanSummary: candidate.humanSummary,
    planStepsAddressed: candidate.planStepsAddressed,
    files: [],
    contextExpansion: { reason: expansion.reason, filesRequested: expansion.filesRequested }
  };
}

export interface CreateDeveloperAgentDependencies {
  modelRouter: ModelRouter;
  executorRegistry: LLMExecutorRegistry;
  tokenEstimator: TokenEstimator;
}

export function createDeveloperAgent(deps: CreateDeveloperAgentDependencies): Agent<DeveloperAgentInput, DeveloperOutput> {
  return {
    role: 'DEVELOPER',

    async execute(input: DeveloperAgentInput): Promise<AgentResult<DeveloperOutput>> {
      const { system, user } = buildDeveloperPrompt(input);

      const llmResult = await invokeLLM(deps, {
        agentRole: 'DEVELOPER',
        systemPrompt: system,
        userMessage: user,
        expectedOutputTokens: EXPECTED_OUTPUT_TOKENS,
        tokenBudget: input.tokenBudget,
        parseOutput: parseDeveloperLLMOutput
      });

      if (llmResult.status !== 'success' || llmResult.output === null) {
        return { ...llmResult, output: null };
      }

      const llmOutput = llmResult.output;

      if (llmOutput.status === 'needs_context') {
        const proposal: ContextExpansionProposal = {
          reason: llmOutput.contextExpansion?.reason ?? '',
          filesRequested: llmOutput.contextExpansion?.filesRequested ?? [],
          estimatedAdditionalTokens: null
        };
        return {
          ...llmResult,
          output: {
            status: 'needs_context',
            summary: llmOutput.summary,
            humanSummary: llmOutput.humanSummary,
            planStepsAddressed: llmOutput.planStepsAddressed,
            filesChanged: [],
            diff: null,
            contextExpansionProposal: proposal
          }
        };
      }

      // The LLM never writes to the filesystem itself — this loop is the only
      // place file content it produced actually reaches disk, and it goes
      // exclusively through the isolated worktree's own path-safety checks.
      try {
        for (const file of llmOutput.files) {
          await input.worktree.writeFile(file.path, file.content);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to write Developer output to the worktree';
        return {
          ...llmResult,
          output: null,
          status: 'failure',
          error: makeAgentExecutionError('file_write_rejected', message, false)
        };
      }

      const { diff } = await input.worktree.getDiff();

      return {
        ...llmResult,
        output: {
          status: 'completed',
          summary: llmOutput.summary,
          humanSummary: llmOutput.humanSummary,
          planStepsAddressed: llmOutput.planStepsAddressed,
          filesChanged: llmOutput.files.map((file) => file.path),
          diff,
          contextExpansionProposal: null
        }
      };
    }
  };
}
