import type { AgentRole, ModelPricing } from '@aet/domain';
import type { ModelCapability } from './capabilities.js';

/**
 * Matches AGENT_DESIGN.md's "Model assignment" table language exactly
 * (Strong / Mid-tier / Low-cost model). A soft ranking preference, not a
 * hard filter — see selection.ts for why.
 */
export type ModelTier = 'strong' | 'mid' | 'low_cost';

/**
 * One entry in a ModelCatalog. `pricing` reuses @aet/domain's `ModelPricing`
 * verbatim rather than redefining price fields — whoever builds the catalog
 * (a future config layer / the Orchestrator) is responsible for resolving
 * which pricing snapshot currently applies (e.g. via
 * token-intelligence's PricingTable.findCurrent()) before constructing
 * this descriptor. model-router itself never resolves "which pricing
 * version is current" — it only ever consumes whatever ModelPricing it
 * was handed.
 */
export interface ModelDescriptor {
  provider: string;
  model: string;
  capabilities: readonly ModelCapability[];
  /** Max input tokens this model accepts. */
  contextLimit: number;
  /** Max output tokens, if known. */
  outputLimit: number | null;
  tier: ModelTier;
  /** Null when no pricing snapshot has been attached yet — cost-based filtering is skipped for such candidates, never treated as "free". */
  pricing: ModelPricing | null;
  /** False when the model is configured but currently unusable (e.g. no credential, disabled). */
  available: boolean;
}

export interface ModelSelectionRequest {
  agentRole: AgentRole;
  requiredCapabilities: readonly ModelCapability[];
  /** Soft preference used for ranking valid candidates — never eliminates a candidate on its own. */
  preferredTier?: ModelTier;
  /** A hard pin — e.g. the Developer/Debugger roles require Claude/Anthropic specifically per AGENT_DESIGN.md's product principle. */
  requiredProvider?: string;
  estimatedInputTokens: number;
  expectedOutputTokens?: number;
  /** Remaining TokenBudget headroom for this task, if known. */
  tokenBudgetRemaining?: number | null;
  /** A cost ceiling for this call, if the caller has one. Only enforced against candidates that have pricing attached. */
  maxEstimatedCost?: number | null;
}

export type RejectionReason =
  | 'unavailable'
  | 'provider_mismatch'
  | 'capability_unavailable'
  | 'context_limit_exceeded'
  | 'budget_exceeds_remaining'
  | 'cost_exceeds_constraint';

export interface RejectedCandidate {
  provider: string;
  model: string;
  reasons: readonly RejectionReason[];
}

/** Structured, not natural-language — a future UI decides how to phrase this. */
export interface SelectionReason {
  matchedPreferredTier: boolean;
  satisfiedCapabilities: readonly ModelCapability[];
  estimatedCost: number | null;
}

export interface ModelSelectionResult {
  selected: ModelDescriptor;
  /** Remaining valid candidates, ranked, in case the caller's actual provider call fails and it wants to retry with the next one — model-router never performs that retry itself. */
  fallbacks: readonly ModelDescriptor[];
  rejectedCandidates: readonly RejectedCandidate[];
  reason: SelectionReason;
}
