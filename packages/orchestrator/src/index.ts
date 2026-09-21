export { createOrchestrator } from './orchestrator.js';
export type { OrchestratorDependencies } from './orchestrator.js';

export type {
  EvaluatedContextExpansion,
  ExecuteTaskInput,
  ExecutionDiff,
  ExecutionDiffFile,
  ExecutionDiffFileStatus,
  HumanReviewResult,
  Orchestrator,
  OrchestrationOutcome,
  OrchestrationResult,
  ReviewExecutionInput
} from './types.js';

export { OrchestrationError } from './errors.js';
export type { OrchestrationErrorKind } from './errors.js';

export { evaluateContextExpansion } from './context-expansion.js';

export { recordAgentExecution, recordContextMetric } from './recording.js';
export type { OrchestratorPersistence, RecordAgentExecutionInput } from './recording.js';

export type { DiffPersistence } from './diff.js';

export { createExecutionReadModel } from './read-model/index.js';
export type {
  AgentExecutionDetails,
  ContextObservability,
  CostObservability,
  ExecutionDetails,
  ExecutionReadModel,
  ExecutionReadModelPersistence,
  LLMRequestDetails,
  RetryObservability,
  ReviewSummary,
  TaskExecutionSummary,
  TokenObservability
} from './read-model/index.js';
