import type { AgentRole, TokenBudget } from '@aet/domain';
import type { ModelCapability, ModelSelectionRequest, ModelTier } from '@aet/model-router';
import { evaluateBudgetStatus } from '@aet/token-intelligence';

interface RoleModelDefaults {
  capabilities: readonly ModelCapability[];
  tier: ModelTier;
}

/**
 * Matches AGENT_DESIGN.md's "Model assignment" table exactly. Not
 * agent-runtime's own opinion — just where that table's defaults live in
 * code.
 *
 * Phase 20.5: Developer/Debugger no longer hard-pin `requiredProvider:
 * 'anthropic'`. That was a hard requirement, not a preference — it made a
 * project with no funded Anthropic credential unable to run these roles
 * with *any* connected provider, including a free fallback. The product
 * principle ("Claude produces fewer errors, so prefer it") is now
 * expressed the same way every other role expresses a preference: `tier:
 * 'strong'`. The composition root's per-project model catalog ranks a
 * connected Anthropic entry at `tier: 'strong'` and Gemini (Phase 22 —
 * replaced the original local Ollama fallback) at a lower tier, so Model
 * Router's existing tier-then-cost ranking (see selection.ts — unchanged)
 * naturally picks Anthropic whenever it's connected, and only falls back to
 * Gemini when it's the sole connected provider. Model Router itself
 * required no change to support this.
 */
const ROLE_DEFAULTS: Readonly<Record<AgentRole, RoleModelDefaults>> = {
  ARCHITECT: { capabilities: ['reasoning', 'structured_output'], tier: 'strong' },
  // 'tool_use' removed (Phase 20.5): developer.ts never actually populates LLMGenerationRequest.tools —
  // it uses structured JSON output (a `files` array), not native tool-calling — so requiring that
  // capability only excluded providers that never needed to support it.
  DEVELOPER: { capabilities: ['reasoning', 'code'], tier: 'strong' },
  QA: { capabilities: ['reasoning'], tier: 'low_cost' },
  CODE_REVIEWER: { capabilities: ['reasoning', 'code'], tier: 'mid' },
  SECURITY_ENGINEER: { capabilities: ['reasoning', 'code'], tier: 'strong' },
  DEBUGGER: { capabilities: ['reasoning', 'code'], tier: 'strong' },
  DOCUMENTATION: { capabilities: ['reasoning'], tier: 'low_cost' }
};

/**
 * Builds the request Model Router needs — agent-runtime owns none of the
 * capability/tier/pricing/fallback logic itself, it only supplies the
 * per-role defaults and the current budget headroom (via Token
 * Intelligence's evaluateBudgetStatus, never recomputed here).
 */
export function buildModelSelectionRequest(
  agentRole: AgentRole,
  estimatedInputTokens: number,
  expectedOutputTokens: number,
  budget: TokenBudget
): ModelSelectionRequest {
  const defaults = ROLE_DEFAULTS[agentRole];
  const { remainingTokens } = evaluateBudgetStatus(budget);

  return {
    agentRole,
    requiredCapabilities: defaults.capabilities,
    preferredTier: defaults.tier,
    estimatedInputTokens,
    expectedOutputTokens,
    tokenBudgetRemaining: remainingTokens,
    maxEstimatedCost: budget.maxCost
  };
}
