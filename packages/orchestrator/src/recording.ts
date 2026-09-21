import type {
  AgentExecution,
  AgentExecutionArtifact,
  AgentExecutionArtifactKind,
  AgentExecutionId,
  AgentExecutionStatus,
  AgentRole,
  ContextPack,
  LLMRequest,
  LLMRequestId,
  LLMRequestPurpose,
  TaskId,
  WorkflowExecutionId
} from '@aet/domain';
import type { AgentOutcomeStatus, AgentResult } from '@aet/agent-runtime';
import type { Persistence } from '@aet/persistence';

/**
 * Only what the Orchestrator actually touches — never the whole
 * `Persistence` surface. `workflowExecutions` and `humanReviewDecisions`
 * were added in Phase 16 exclusively for `reviewExecution()`'s atomic
 * decision+transition transaction (see review.ts) — `execute()` still
 * never reads/writes either directly; every one of its own transitions
 * goes through the injected `WorkflowEngine`. `executionWorktrees` was
 * added in Phase 17: `execute()` records the worktree/branch/base-commit
 * it created (the only writer), and `getExecutionDiff()` (see diff.ts)
 * reads it back to safely resolve which worktree an execution's diff
 * should come from.
 */
export type OrchestratorPersistence = Pick<
  Persistence,
  | 'tasks'
  | 'workflowExecutions'
  | 'agentExecutions'
  | 'llmRequests'
  | 'contextMetrics'
  | 'humanReviewDecisions'
  | 'executionWorktrees'
  | 'transaction'
>;

function toAgentExecutionStatus(status: AgentOutcomeStatus): AgentExecutionStatus {
  return status === 'success' ? 'SUCCEEDED' : 'FAILED';
}

export interface RecordAgentExecutionStartedInput {
  agentExecutionId: AgentExecutionId;
  taskId: TaskId;
  workflowExecutionId: WorkflowExecutionId;
  agentRole: AgentRole;
  retryNumber: number;
  startedAt: string;
}

/**
 * Persists a RUNNING placeholder the moment an agent call begins, before
 * anything is known about its outcome. Without this, the read model had no
 * row at all for a stage still in flight — `recordAgentExecution` below
 * only ever wrote a row AFTER the call finished — so a human watching a
 * multi-minute local-model generation had no signal that anything was
 * happening versus the pipeline being stuck (see live-testing report).
 * `recordAgentExecution` UPDATEs this same row once the outcome is known,
 * rather than creating a second one — see its own doc comment.
 */
export function recordAgentExecutionStarted(persistence: OrchestratorPersistence, input: RecordAgentExecutionStartedInput): void {
  const agentExecution: AgentExecution = {
    id: input.agentExecutionId,
    taskId: input.taskId,
    workflowExecutionId: input.workflowExecutionId,
    agentRole: input.agentRole,
    status: 'RUNNING',
    retryNumber: input.retryNumber,
    startedAt: input.startedAt,
    completedAt: null,
    llmRequestIds: [],
    outputArtifact: null,
    errorMessage: null
  };
  persistence.agentExecutions.create(agentExecution);
}

export interface RecordAgentExecutionInput<TOutput> {
  agentExecutionId: AgentExecutionId;
  taskId: TaskId;
  workflowExecutionId: WorkflowExecutionId;
  agentRole: AgentRole;
  retryNumber: number;
  purpose: LLMRequestPurpose;
  artifactKind: AgentExecutionArtifactKind;
  result: AgentResult<TOutput>;
}

/**
 * Updates the RUNNING placeholder `recordAgentExecutionStarted` created to
 * its final outcome, and (when a call was actually attempted) persists its
 * LLMRequest, atomically in one transaction.
 *
 * `providerReportedUsage` now comes from `AgentResult.rawProviderUsage`
 * (Phase 10 identified this as missing; Phase 11 closed it with the
 * smallest correct change — see agent-runtime's types.ts/execution.ts).
 * Still `null` whenever the provider genuinely didn't return one, or no
 * response was ever received (e.g. model selection failed) — never fabricated.
 */
export function recordAgentExecution<TOutput>(
  persistence: OrchestratorPersistence,
  llmRequestId: LLMRequestId,
  input: RecordAgentExecutionInput<TOutput>
): void {
  const { result } = input;

  const outputArtifact: AgentExecutionArtifact | null =
    result.output === null ? null : { kind: input.artifactKind, data: result.output as unknown as Record<string, unknown> };

  const agentExecution: AgentExecution = {
    id: input.agentExecutionId,
    taskId: input.taskId,
    workflowExecutionId: input.workflowExecutionId,
    agentRole: input.agentRole,
    status: toAgentExecutionStatus(result.status),
    retryNumber: input.retryNumber,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    llmRequestIds: result.provider !== null ? [llmRequestId] : [],
    outputArtifact,
    errorMessage: result.status === 'success' ? null : (result.error?.message ?? null)
  };

  persistence.transaction(() => {
    // The RUNNING row from recordAgentExecutionStarted already exists — this UPDATEs it rather
    // than inserting a second row. That ordering also happens to be what llm_requests needs:
    // its agent_execution_id is a NOT NULL foreign key, and SQLite checks foreign keys
    // immediately per-statement (not deferred to commit), so the referenced row must already
    // exist — which it does, from the earlier create() call.
    persistence.agentExecutions.update(agentExecution);
    if (result.provider !== null && result.model !== null) {
      const llmRequest: LLMRequest = {
        id: llmRequestId,
        taskId: input.taskId,
        agentExecutionId: input.agentExecutionId,
        provider: result.provider,
        providerModel: result.model,
        purpose: input.purpose,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        normalizedUsage: result.usage,
        providerReportedUsage: result.rawProviderUsage,
        cost: result.cost
      };
      persistence.llmRequests.create(llmRequest);
    }
  });
}

export function recordContextMetric(
  persistence: OrchestratorPersistence,
  id: string,
  taskId: TaskId,
  workflowExecutionId: WorkflowExecutionId,
  contextPack: ContextPack
): void {
  persistence.contextMetrics.create({
    id,
    taskId,
    workflowExecutionId,
    metric: contextPack.metric,
    createdAt: contextPack.createdAt
  });
}
