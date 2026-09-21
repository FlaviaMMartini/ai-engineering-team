import type { GitDiff } from '@aet/git-integration';
import type { ModelRouter } from '@aet/model-router';
import type { TokenEstimator } from '@aet/token-intelligence';
import { invokeLLM } from '../execution.js';
import { buildQaPrompt } from '../prompts/qa.js';
import type { Agent, AgentInput, AgentResult, LLMExecutorRegistry } from '../types.js';
import type { ArchitectPlan } from './architect.js';

/** Raised from 1500 to leave headroom for the new "humanSummary"/"futureImprovements" fields (see prompts/qa.ts) on top of the existing findings. */
const EXPECTED_OUTPUT_TOKENS = 2000;

/**
 * Deterministic test execution (per AGENT_DESIGN.md: "Runs the project's
 * real test command deterministically, no LLM") is explicitly NOT part of
 * this phase — it needs a "run the project's test command" capability
 * that doesn't exist in git-integration yet (which only offers
 * read/write/diff/commit, not arbitrary command execution). This QAAgent
 * covers only the LLM-based interpretation step: given a diff that was
 * already produced, does it plausibly satisfy the task and the plan's
 * acceptance criteria. Wiring in real test execution is future work for
 * whichever phase adds that capability.
 */
export interface QAAgentInput extends AgentInput {
  architectPlan: ArchitectPlan;
  diff: GitDiff;
}

export type QAStatus = 'pass' | 'fail';
export type QAFindingSeverity = 'blocker' | 'major' | 'minor';

export interface QAFinding {
  severity: QAFindingSeverity;
  description: string;
  relatedFile: string | null;
}

export interface QAResult {
  status: QAStatus;
  findings: readonly QAFinding[];
  summary: string;
  /** A plain-language test report for a human reader: what was checked, what passed, what failed and had to be fixed (if this is a retry), and why the overall verdict is pass/fail. */
  humanSummary: string;
  /** Non-blocking suggestions worth a future backlog item — never something that should have blocked this pass/fail verdict (those belong in `findings`). Empty array, not omitted, when there are none. */
  futureImprovements: readonly string[];
}

function isFindingArray(value: unknown): value is QAFinding[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const finding = entry as Record<string, unknown>;
      const validSeverity = finding.severity === 'blocker' || finding.severity === 'major' || finding.severity === 'minor';
      const validRelatedFile = finding.relatedFile === null || typeof finding.relatedFile === 'string';
      return validSeverity && typeof finding.description === 'string' && validRelatedFile;
    })
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Structural validation of our own JSON contract — not a schema library, deliberately small. */
function parseQAResult(text: string): QAResult {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('QA output is not a JSON object');
  }
  const candidate = parsed as Record<string, unknown>;

  if (candidate.status !== 'pass' && candidate.status !== 'fail') {
    throw new Error('QA output has an invalid status');
  }
  if (typeof candidate.summary !== 'string' || typeof candidate.humanSummary !== 'string') {
    throw new Error('QA output is missing required fields (summary, humanSummary)');
  }
  if (!isFindingArray(candidate.findings)) {
    throw new Error('QA output has an invalid findings[] array');
  }
  if (!isStringArray(candidate.futureImprovements)) {
    throw new Error('QA output has an invalid futureImprovements[] array');
  }

  return {
    status: candidate.status,
    findings: candidate.findings,
    summary: candidate.summary,
    humanSummary: candidate.humanSummary,
    futureImprovements: candidate.futureImprovements
  };
}

export interface CreateQaAgentDependencies {
  modelRouter: ModelRouter;
  executorRegistry: LLMExecutorRegistry;
  tokenEstimator: TokenEstimator;
}

export function createQaAgent(deps: CreateQaAgentDependencies): Agent<QAAgentInput, QAResult> {
  return {
    role: 'QA',

    async execute(input: QAAgentInput): Promise<AgentResult<QAResult>> {
      const { system, user } = buildQaPrompt(input);

      return invokeLLM(deps, {
        agentRole: 'QA',
        systemPrompt: system,
        userMessage: user,
        expectedOutputTokens: EXPECTED_OUTPUT_TOKENS,
        tokenBudget: input.tokenBudget,
        parseOutput: parseQAResult
      });
    }
  };
}
