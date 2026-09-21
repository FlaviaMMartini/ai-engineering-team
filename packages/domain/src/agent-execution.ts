import type { AgentExecutionId, LLMRequestId, TaskId, WorkflowExecutionId } from './ids.js';
import type { AgentRole } from './agent.js';

export type AgentExecutionStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type AgentExecutionArtifactKind = 'PLAN' | 'DIFF_SUMMARY' | 'TEST_RESULT_SUMMARY' | 'REVIEW_FINDINGS';

/** Minimal, typed reference to an agent's structured output — not a copy of the full artifact. */
export interface AgentExecutionArtifact {
  kind: AgentExecutionArtifactKind;
  data: Record<string, unknown>;
}

export interface AgentExecution {
  id: AgentExecutionId;
  taskId: TaskId;
  workflowExecutionId: WorkflowExecutionId;
  agentRole: AgentRole;
  status: AgentExecutionStatus;
  retryNumber: number;
  startedAt: string;
  completedAt: string | null;
  llmRequestIds: readonly LLMRequestId[];
  outputArtifact: AgentExecutionArtifact | null;
  /**
   * Non-null exactly when status is 'FAILED' — the real reason this agent
   * call failed (model selection, provider error, invalid output), so a
   * human looking at a blocked/failed task isn't left with a red "Failed"
   * chip and no explanation. Never fabricated: this is `AgentResult.error`'s
   * own message, the same text the initial `POST /tasks/:id/execute`
   * response already carried in `errorMessage` — this just makes it visible
   * on every later poll too, not only in that one response.
   */
  errorMessage: string | null;
}
