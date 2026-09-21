import type Database from 'better-sqlite3';

/**
 * Bumped whenever CREATE_TABLES_SQL changes. `initializeSchema` only ever
 * applies the full schema once (schema_meta has no row yet); a future
 * migration framework reads this same schema_meta.version row to decide
 * what deltas to apply, without repositories changing at all.
 */
const SCHEMA_VERSION = 7;

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT NOT NULL,
  branch_name TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  max_tokens INTEGER,
  max_cost REAL,
  estimated_input_tokens INTEGER,
  estimated_output_tokens INTEGER,
  estimated_cache_creation_tokens INTEGER,
  estimated_cache_read_tokens INTEGER,
  estimated_total_tokens INTEGER,
  actual_input_tokens INTEGER,
  actual_output_tokens INTEGER,
  actual_cache_creation_tokens INTEGER,
  actual_cache_read_tokens INTEGER,
  actual_total_tokens INTEGER,
  estimated_cost REAL,
  calculated_cost REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
-- Phase 21 (Kanban board): the board lists a project's tasks grouped by state, so this is a
-- real query pattern now, not speculative.
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_task_id ON workflow_executions(task_id);

CREATE TABLE IF NOT EXISTS agent_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  workflow_execution_id TEXT NOT NULL REFERENCES workflow_executions(id),
  agent_role TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_number INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  output_artifact_kind TEXT,
  output_artifact_data TEXT,
  -- Phase 23: the real reason a FAILED execution failed — see domain's AgentExecution doc comment.
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_task_id ON agent_executions(task_id);

CREATE TABLE IF NOT EXISTS llm_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  agent_execution_id TEXT NOT NULL REFERENCES agent_executions(id),
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens INTEGER,
  total_tokens INTEGER,
  provider_reported_usage TEXT,
  estimated_cost REAL,
  calculated_cost REAL,
  pricing_version TEXT,
  currency TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_requests_task_id ON llm_requests(task_id);
CREATE INDEX IF NOT EXISTS idx_llm_requests_agent_execution_id ON llm_requests(agent_execution_id);

CREATE TABLE IF NOT EXISTS context_metrics (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  workflow_execution_id TEXT REFERENCES workflow_executions(id),
  files_scanned INTEGER NOT NULL,
  files_selected INTEGER NOT NULL,
  relevance_scores TEXT NOT NULL DEFAULT '[]',
  estimated_full_repository_tokens INTEGER NOT NULL,
  estimated_selected_context_tokens INTEGER NOT NULL,
  context_avoided INTEGER GENERATED ALWAYS AS (estimated_full_repository_tokens - estimated_selected_context_tokens) STORED,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_metrics_task_id ON context_metrics(task_id);

CREATE TABLE IF NOT EXISTS human_review_decisions (
  id TEXT PRIMARY KEY,
  workflow_execution_id TEXT NOT NULL REFERENCES workflow_executions(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  decision TEXT NOT NULL,
  comment TEXT,
  decided_at TEXT NOT NULL
);

-- At most one decision per execution (Phase 16: no reopening a decided review in this phase).
CREATE UNIQUE INDEX IF NOT EXISTS idx_human_review_decisions_execution_id ON human_review_decisions(workflow_execution_id);
CREATE INDEX IF NOT EXISTS idx_human_review_decisions_task_id ON human_review_decisions(task_id);

-- Phase 17: durably associates a WorkflowExecution with the isolated AI worktree/branch the
-- pipeline created for it. Without this, a later request (e.g. "show this execution's diff")
-- has no trusted way to find the worktree — AiWorktree itself is only an in-memory handle,
-- discarded once execute()'s HTTP response is sent. One row per execution (1:1), so
-- workflow_execution_id is the primary key rather than a separate surrogate id.
CREATE TABLE IF NOT EXISTS execution_worktrees (
  workflow_execution_id TEXT PRIMARY KEY REFERENCES workflow_executions(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  worktree_path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_commit_sha TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_worktrees_task_id ON execution_worktrees(task_id);

-- Phase 19 (BYOK): minimal project identity. No update()/delete() — editing/removing a
-- project is out of scope; this exists so a provider configuration has something real to
-- reference and a Task's existing (previously unconstrained) project_id means something.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

-- The encrypted secret only. Never a plaintext column, never the master key. ciphertext/iv/
-- auth_tag are base64; encryption_version lets a future re-encryption migration coexist with
-- old rows during rollout.
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  encryption_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Non-secret provider configuration for one project. unique(project_id, provider) is the
-- project-isolation guarantee at the schema level: a project can have at most one
-- configuration row per provider, and every credential lookup must go through this row —
-- never accept a credential_id directly from a caller (see @aet/credentials).
CREATE TABLE IF NOT EXISTS project_provider_configurations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  credential_id TEXT REFERENCES credentials(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_provider_configurations_unique ON project_provider_configurations(project_id, provider);
CREATE INDEX IF NOT EXISTS idx_project_provider_configurations_project_id ON project_provider_configurations(project_id);

-- Phase 21 (repository selection): a project's registered local repositories — either an
-- existing folder the user pointed at (validated as a real git repo), or one this application
-- initialized from scratch for a brand-new task (see git-integration's initializeNewRepository).
-- unique(project_id, local_path) prevents the same folder being registered twice under one project.
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  local_path TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  remote_url TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_repositories_unique_path ON repositories(project_id, local_path);
CREATE INDEX IF NOT EXISTS idx_repositories_project_id ON repositories(project_id);
`;

/**
 * Deterministic, idempotent schema initialization: applies the full schema
 * exactly once (tracked via schema_meta.version). No migration framework
 * yet — when one is needed, it reads schema_meta.version and applies
 * ordered deltas from there, without any repository code changing.
 */
export function initializeSchema(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');

  const row = db.prepare<[], { version: number }>('SELECT version FROM schema_meta WHERE id = 1').get();
  if (row === undefined) {
    db.exec(CREATE_TABLES_SQL);
    db.prepare<[number]>('INSERT INTO schema_meta (id, version) VALUES (1, ?)').run(SCHEMA_VERSION);
  }
}
