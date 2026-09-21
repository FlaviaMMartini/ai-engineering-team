import type { ModelRouter } from '@aet/model-router';
import type { TokenEstimator } from '@aet/token-intelligence';
import { createArchitectAgent, type ArchitectAgentInput, type ArchitectPlan } from './agents/architect.js';
import { createDeveloperAgent, type DeveloperAgentInput, type DeveloperOutput } from './agents/developer.js';
import { createQaAgent, type QAAgentInput, type QAResult } from './agents/qa.js';
import type { Agent, LLMExecutorRegistry } from './types.js';

export interface AgentRuntimeDependencies {
  modelRouter: ModelRouter;
  /** Concrete `LLMProvider` instances (e.g. from @aet/providers' createAnthropicProvider) are injected here by the composition root — this package never imports @aet/providers itself. */
  executorRegistry: LLMExecutorRegistry;
  tokenEstimator: TokenEstimator;
}

export interface AgentRuntime {
  architect: Agent<ArchitectAgentInput, ArchitectPlan>;
  developer: Agent<DeveloperAgentInput, DeveloperOutput>;
  qa: Agent<QAAgentInput, QAResult>;
}

/**
 * Wires the shared dependencies (Model Router, the injected executor
 * registry, the token estimator) into each MVP agent. This is a
 * dependency-wiring factory only — sequencing which agent runs when, and
 * what happens on failure/retry, belongs to the Workflow Engine/
 * Orchestrator (later phases), not here.
 */
export function createAgentRuntime(deps: AgentRuntimeDependencies): AgentRuntime {
  return {
    architect: createArchitectAgent(deps),
    developer: createDeveloperAgent(deps),
    qa: createQaAgent(deps)
  };
}
