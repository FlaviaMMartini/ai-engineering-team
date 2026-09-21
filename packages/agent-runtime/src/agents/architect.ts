import type { ModelRouter } from '@aet/model-router';
import type { TokenEstimator } from '@aet/token-intelligence';
import { invokeLLM } from '../execution.js';
import { buildArchitectPrompt } from '../prompts/architect.js';
import type { Agent, AgentInput, AgentResult, LLMExecutorRegistry } from '../types.js';

/** Raised from 2000 to leave headroom for the new "humanSummary" narrative field (see prompts/architect.ts) on top of the existing structured plan fields. */
const EXPECTED_OUTPUT_TOKENS = 2500;

export type ArchitectAgentInput = AgentInput;

/** Matches AGENT_DESIGN.md's Architect description: "plan steps, affected files, dependencies, acceptance criteria, risks, complexity estimate." */
export interface ArchitectPlan {
  summary: string;
  approach: string;
  filesToModify: readonly string[];
  filesToCreate: readonly string[];
  acceptanceCriteria: readonly string[];
  dependencies: readonly string[];
  risks: readonly string[];
  validationPlan: readonly string[];
  complexityEstimate: 'low' | 'medium' | 'high';
  /** A human-readable time estimate for the whole task (e.g. "15-30 minutes", "2-3 hours") — not a token/cost estimate, a delivery-time one, shown to the human before execution starts. */
  estimatedEffort: string;
  /**
   * A plain-language paragraph for a non-technical stakeholder: what will
   * be built and why, the key decisions behind this plan, and the
   * acceptance criteria restated in everyday terms — distinct from
   * `summary`/`approach`, which are written for the Developer agent, not a
   * human reader.
   */
  humanSummary: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Structural validation only — this is our own JSON contract, not a schema library, deliberately kept small. */
function parseArchitectPlan(text: string): ArchitectPlan {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Architect output is not a JSON object');
  }
  const candidate = parsed as Record<string, unknown>;

  if (
    typeof candidate.summary !== 'string' ||
    typeof candidate.approach !== 'string' ||
    typeof candidate.estimatedEffort !== 'string' ||
    typeof candidate.humanSummary !== 'string'
  ) {
    throw new Error('Architect output is missing required string fields (summary, approach, estimatedEffort, humanSummary)');
  }
  if (
    !isStringArray(candidate.filesToModify) ||
    !isStringArray(candidate.filesToCreate) ||
    !isStringArray(candidate.acceptanceCriteria) ||
    !isStringArray(candidate.dependencies) ||
    !isStringArray(candidate.risks) ||
    !isStringArray(candidate.validationPlan)
  ) {
    throw new Error('Architect output is missing one or more required string-array fields');
  }
  if (candidate.complexityEstimate !== 'low' && candidate.complexityEstimate !== 'medium' && candidate.complexityEstimate !== 'high') {
    throw new Error('Architect output has an invalid complexityEstimate');
  }

  return {
    summary: candidate.summary,
    approach: candidate.approach,
    filesToModify: candidate.filesToModify,
    filesToCreate: candidate.filesToCreate,
    acceptanceCriteria: candidate.acceptanceCriteria,
    dependencies: candidate.dependencies,
    risks: candidate.risks,
    validationPlan: candidate.validationPlan,
    complexityEstimate: candidate.complexityEstimate,
    estimatedEffort: candidate.estimatedEffort,
    humanSummary: candidate.humanSummary
  };
}

export interface CreateArchitectAgentDependencies {
  modelRouter: ModelRouter;
  executorRegistry: LLMExecutorRegistry;
  tokenEstimator: TokenEstimator;
}

export function createArchitectAgent(deps: CreateArchitectAgentDependencies): Agent<ArchitectAgentInput, ArchitectPlan> {
  return {
    role: 'ARCHITECT',

    async execute(input: ArchitectAgentInput): Promise<AgentResult<ArchitectPlan>> {
      const { system, user } = buildArchitectPrompt(input);

      return invokeLLM(deps, {
        agentRole: 'ARCHITECT',
        systemPrompt: system,
        userMessage: user,
        expectedOutputTokens: EXPECTED_OUTPUT_TOKENS,
        tokenBudget: input.tokenBudget,
        parseOutput: parseArchitectPlan
      });
    }
  };
}
