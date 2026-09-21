import type { ReviewId, TaskId, WorkflowExecutionId } from './ids.js';

export type HumanReviewDecisionType = 'APPROVED' | 'REJECTED';

/**
 * A durable record of a human's decision on one execution's result.
 * Belongs to the WorkflowExecution as a whole (not to an individual
 * AgentExecution or LLMRequest) — the human reviews what the whole
 * pipeline produced, not one agent's output. See AGENT_DESIGN.md's product
 * principle: AI executes/proposes/validates, only a human decides.
 * Deliberately has no notion of "AI_APPROVED" — this type exists precisely
 * because an AI must never approve its own work.
 */
export interface HumanReviewDecision {
  id: ReviewId;
  executionId: WorkflowExecutionId;
  taskId: TaskId;
  decision: HumanReviewDecisionType;
  comment: string | null;
  decidedAt: string;
}
