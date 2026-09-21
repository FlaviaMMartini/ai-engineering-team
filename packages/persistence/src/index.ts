export type { Persistence } from './persistence.js';
export { createPersistence } from './persistence.js';

export type { TaskRepository } from './repositories/task-repository.js';
export type { WorkflowExecutionRepository } from './repositories/workflow-execution-repository.js';
export type { AgentExecutionRepository } from './repositories/agent-execution-repository.js';
export type { LLMRequestRepository } from './repositories/llm-request-repository.js';
export type { ContextMetricRepository, ContextMetricRecord } from './repositories/context-metric-repository.js';
export type { HumanReviewDecisionRepository } from './repositories/human-review-decision-repository.js';
export type { ExecutionWorktreeRecord, ExecutionWorktreeRepository } from './repositories/execution-worktree-repository.js';
export type { ProjectRepository } from './repositories/project-repository.js';
export type { RepositoryRepository } from './repositories/repository-repository.js';
export type { CredentialRecord, CredentialRepository } from './repositories/credential-repository.js';
export type { ProjectProviderConfigurationRepository } from './repositories/project-provider-configuration-repository.js';

export type { TransactionRunner } from './transaction.js';

export { PersistenceError, NotFoundError, DuplicateIdError, ForeignKeyViolationError } from './errors.js';

export type { CredentialStore, CredentialStoreDependencies } from './credential-store.js';
export { createCredentialStore } from './credential-store.js';

export { parseMasterKey, CURRENT_ENCRYPTION_VERSION } from './crypto/aes-gcm.js';
export type { EncryptedSecret } from './crypto/aes-gcm.js';
