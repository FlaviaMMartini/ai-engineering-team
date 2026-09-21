import { openConnection } from './db/connection.js';
import { SqliteAgentExecutionRepository, type AgentExecutionRepository } from './repositories/agent-execution-repository.js';
import { SqliteContextMetricRepository, type ContextMetricRepository } from './repositories/context-metric-repository.js';
import { SqliteCredentialRepository, type CredentialRepository } from './repositories/credential-repository.js';
import {
  SqliteExecutionWorktreeRepository,
  type ExecutionWorktreeRepository
} from './repositories/execution-worktree-repository.js';
import {
  SqliteHumanReviewDecisionRepository,
  type HumanReviewDecisionRepository
} from './repositories/human-review-decision-repository.js';
import { SqliteLLMRequestRepository, type LLMRequestRepository } from './repositories/llm-request-repository.js';
import {
  SqliteProjectProviderConfigurationRepository,
  type ProjectProviderConfigurationRepository
} from './repositories/project-provider-configuration-repository.js';
import { SqliteProjectRepository, type ProjectRepository } from './repositories/project-repository.js';
import { SqliteRepositoryRepository, type RepositoryRepository } from './repositories/repository-repository.js';
import { SqliteTaskRepository, type TaskRepository } from './repositories/task-repository.js';
import {
  SqliteWorkflowExecutionRepository,
  type WorkflowExecutionRepository
} from './repositories/workflow-execution-repository.js';
import { createTransactionRunner, type TransactionRunner } from './transaction.js';

/**
 * The public contract of this package. No better-sqlite3 type appears
 * anywhere in this interface — everything else in the application depends
 * on this, never on the concrete Sqlite* repository classes.
 */
export interface Persistence {
  readonly tasks: TaskRepository;
  readonly workflowExecutions: WorkflowExecutionRepository;
  readonly agentExecutions: AgentExecutionRepository;
  readonly llmRequests: LLMRequestRepository;
  readonly contextMetrics: ContextMetricRepository;
  readonly humanReviewDecisions: HumanReviewDecisionRepository;
  readonly executionWorktrees: ExecutionWorktreeRepository;
  readonly projects: ProjectRepository;
  readonly repositories: RepositoryRepository;
  readonly credentials: CredentialRepository;
  readonly projectProviderConfigurations: ProjectProviderConfigurationRepository;
  readonly transaction: TransactionRunner;
  close(): void;
}

/** `path` may be a file path or `:memory:` (used by this package's own tests). */
export function createPersistence(path: string): Persistence {
  const db = openConnection(path);

  return {
    tasks: new SqliteTaskRepository(db),
    workflowExecutions: new SqliteWorkflowExecutionRepository(db),
    agentExecutions: new SqliteAgentExecutionRepository(db),
    llmRequests: new SqliteLLMRequestRepository(db),
    contextMetrics: new SqliteContextMetricRepository(db),
    humanReviewDecisions: new SqliteHumanReviewDecisionRepository(db),
    executionWorktrees: new SqliteExecutionWorktreeRepository(db),
    projects: new SqliteProjectRepository(db),
    repositories: new SqliteRepositoryRepository(db),
    credentials: new SqliteCredentialRepository(db),
    projectProviderConfigurations: new SqliteProjectProviderConfigurationRepository(db),
    transaction: createTransactionRunner(db),
    close: () => {
      db.close();
    }
  };
}
