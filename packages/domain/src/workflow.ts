import type {
  AgentExecutionId,
  ContextExpansionRequestId,
  ContextPackId,
  EventId,
  LLMRequestId,
  TaskId,
  WorkflowExecutionId
} from './ids.js';
import type { AgentRole } from './agent.js';
import type { TokenUsage } from './tokens.js';

export type WorkflowExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

/** One attempt at running a Task through the pipeline. See DOMAIN_MODEL.md. */
export interface WorkflowExecution {
  id: WorkflowExecutionId;
  taskId: TaskId;
  status: WorkflowExecutionStatus;
  startedAt: string;
  completedAt: string | null;
}

interface WorkflowEventBase {
  id: EventId;
  taskId: TaskId;
  workflowExecutionId: WorkflowExecutionId;
  occurredAt: string;
}

/**
 * Typed domain representation of every execution event the pipeline emits.
 * No event bus here — just the shape each event type carries.
 */
export type WorkflowEvent =
  | (WorkflowEventBase & { type: 'TASK_CREATED' })
  | (WorkflowEventBase & { type: 'REPOSITORY_DISCOVERED'; filesScanned: number })
  | (WorkflowEventBase & { type: 'CONTEXT_ANALYZED'; contextPackId: ContextPackId; filesSelected: number })
  | (WorkflowEventBase & { type: 'TOKENS_ESTIMATED'; estimatedTokens: number })
  | (WorkflowEventBase & { type: 'MODEL_SELECTED'; agentRole: AgentRole; provider: string; providerModel: string })
  | (WorkflowEventBase & { type: 'AGENT_STARTED'; agentExecutionId: AgentExecutionId; agentRole: AgentRole })
  | (WorkflowEventBase & { type: 'LLM_REQUEST_STARTED'; llmRequestId: LLMRequestId })
  | (WorkflowEventBase & { type: 'LLM_REQUEST_COMPLETED'; llmRequestId: LLMRequestId; usage: TokenUsage })
  | (WorkflowEventBase & { type: 'CONTEXT_EXPANSION_REQUESTED'; contextExpansionRequestId: ContextExpansionRequestId })
  | (WorkflowEventBase & {
      type: 'CONTEXT_EXPANSION_APPROVED';
      contextExpansionRequestId: ContextExpansionRequestId;
      filesApproved: readonly string[];
    })
  | (WorkflowEventBase & {
      type: 'CONTEXT_EXPANSION_DENIED';
      contextExpansionRequestId: ContextExpansionRequestId;
      reason: string;
    })
  | (WorkflowEventBase & { type: 'FILES_MODIFIED'; filePaths: readonly string[] })
  | (WorkflowEventBase & { type: 'TESTS_STARTED' })
  | (WorkflowEventBase & { type: 'TESTS_COMPLETED'; passed: boolean; durationMs: number })
  | (WorkflowEventBase & { type: 'QA_PASSED' })
  | (WorkflowEventBase & { type: 'QA_FAILED'; reason: string })
  | (WorkflowEventBase & { type: 'HUMAN_REVIEW_REQUIRED'; reason: string })
  | (WorkflowEventBase & { type: 'HUMAN_REVIEW_APPROVED'; comment: string | null })
  | (WorkflowEventBase & { type: 'HUMAN_REVIEW_REJECTED'; comment: string | null })
  | (WorkflowEventBase & { type: 'TASK_COMPLETED' })
  | (WorkflowEventBase & { type: 'TASK_FAILED'; reason: string });

export type WorkflowEventType = WorkflowEvent['type'];
