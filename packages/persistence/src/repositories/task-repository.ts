import type Database from 'better-sqlite3';
import type { Currency, ProjectId, Task, TaskId, TaskState, TokenBudget } from '@aet/domain';
import { NotFoundError, translateSqliteError } from '../errors.js';

export interface TaskRow {
  id: string;
  project_id: string;
  repository_id: string;
  description: string;
  state: string;
  branch_name: string | null;
  retry_count: number;
  currency: string;
  max_tokens: number | null;
  max_cost: number | null;
  estimated_input_tokens: number | null;
  estimated_output_tokens: number | null;
  estimated_cache_creation_tokens: number | null;
  estimated_cache_read_tokens: number | null;
  estimated_total_tokens: number | null;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  actual_cache_creation_tokens: number | null;
  actual_cache_read_tokens: number | null;
  actual_total_tokens: number | null;
  estimated_cost: number | null;
  calculated_cost: number | null;
  created_at: string;
  updated_at: string;
}

type BudgetRowFields = Pick<
  TaskRow,
  | 'currency'
  | 'max_tokens'
  | 'max_cost'
  | 'estimated_input_tokens'
  | 'estimated_output_tokens'
  | 'estimated_cache_creation_tokens'
  | 'estimated_cache_read_tokens'
  | 'estimated_total_tokens'
  | 'actual_input_tokens'
  | 'actual_output_tokens'
  | 'actual_cache_creation_tokens'
  | 'actual_cache_read_tokens'
  | 'actual_total_tokens'
  | 'estimated_cost'
  | 'calculated_cost'
>;

export function budgetToRowFields(budget: TokenBudget): BudgetRowFields {
  return {
    currency: budget.currency,
    max_tokens: budget.maxTokens,
    max_cost: budget.maxCost,
    estimated_input_tokens: budget.estimatedUsage.inputTokens,
    estimated_output_tokens: budget.estimatedUsage.outputTokens,
    estimated_cache_creation_tokens: budget.estimatedUsage.cacheCreationTokens,
    estimated_cache_read_tokens: budget.estimatedUsage.cacheReadTokens,
    estimated_total_tokens: budget.estimatedUsage.totalTokens,
    actual_input_tokens: budget.actualUsage.inputTokens,
    actual_output_tokens: budget.actualUsage.outputTokens,
    actual_cache_creation_tokens: budget.actualUsage.cacheCreationTokens,
    actual_cache_read_tokens: budget.actualUsage.cacheReadTokens,
    actual_total_tokens: budget.actualUsage.totalTokens,
    estimated_cost: budget.estimatedCost,
    calculated_cost: budget.calculatedCost
  };
}

export function taskToRow(task: Task, budget: TokenBudget): TaskRow {
  return {
    id: task.id,
    project_id: task.projectId,
    repository_id: task.repositoryId,
    description: task.description,
    state: task.state,
    branch_name: task.branchName,
    retry_count: task.retryCount,
    ...budgetToRowFields(budget),
    created_at: task.createdAt,
    updated_at: task.updatedAt
  };
}

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    repositoryId: row.repository_id,
    description: row.description,
    state: row.state as TaskState,
    branchName: row.branch_name,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function rowToBudget(row: TaskRow): TokenBudget {
  return {
    taskId: row.id,
    maxTokens: row.max_tokens,
    maxCost: row.max_cost,
    currency: row.currency as Currency,
    estimatedUsage: {
      inputTokens: row.estimated_input_tokens,
      outputTokens: row.estimated_output_tokens,
      cacheCreationTokens: row.estimated_cache_creation_tokens,
      cacheReadTokens: row.estimated_cache_read_tokens,
      totalTokens: row.estimated_total_tokens
    },
    actualUsage: {
      inputTokens: row.actual_input_tokens,
      outputTokens: row.actual_output_tokens,
      cacheCreationTokens: row.actual_cache_creation_tokens,
      cacheReadTokens: row.actual_cache_read_tokens,
      totalTokens: row.actual_total_tokens
    },
    estimatedCost: row.estimated_cost,
    calculatedCost: row.calculated_cost
  };
}

export interface TaskRepository {
  /** A Task always has a TokenBudget from creation — there is no valid state where one exists without the other. */
  create(task: Task, budget: TokenBudget): void;
  findById(id: TaskId): Task | null;
  findBudgetByTaskId(id: TaskId): TokenBudget | null;
  update(task: Task): void;
  updateBudget(budget: TokenBudget): void;
  list(): readonly Task[];
  /** Phase 21 (Kanban board): a project's tasks, oldest first — the board groups these by `state` into columns. */
  listByProject(projectId: ProjectId): readonly Task[];
}

const INSERT_SQL = `
  INSERT INTO tasks (
    id, project_id, repository_id, description, state, branch_name, retry_count, currency,
    max_tokens, max_cost,
    estimated_input_tokens, estimated_output_tokens, estimated_cache_creation_tokens, estimated_cache_read_tokens, estimated_total_tokens,
    actual_input_tokens, actual_output_tokens, actual_cache_creation_tokens, actual_cache_read_tokens, actual_total_tokens,
    estimated_cost, calculated_cost, created_at, updated_at
  ) VALUES (
    @id, @project_id, @repository_id, @description, @state, @branch_name, @retry_count, @currency,
    @max_tokens, @max_cost,
    @estimated_input_tokens, @estimated_output_tokens, @estimated_cache_creation_tokens, @estimated_cache_read_tokens, @estimated_total_tokens,
    @actual_input_tokens, @actual_output_tokens, @actual_cache_creation_tokens, @actual_cache_read_tokens, @actual_total_tokens,
    @estimated_cost, @calculated_cost, @created_at, @updated_at
  )
`;

const UPDATE_TASK_SQL = `
  UPDATE tasks
  SET state = @state, branch_name = @branch_name, retry_count = @retry_count, updated_at = @updated_at
  WHERE id = @id
`;

const UPDATE_BUDGET_SQL = `
  UPDATE tasks
  SET
    currency = @currency,
    max_tokens = @max_tokens,
    max_cost = @max_cost,
    estimated_input_tokens = @estimated_input_tokens,
    estimated_output_tokens = @estimated_output_tokens,
    estimated_cache_creation_tokens = @estimated_cache_creation_tokens,
    estimated_cache_read_tokens = @estimated_cache_read_tokens,
    estimated_total_tokens = @estimated_total_tokens,
    actual_input_tokens = @actual_input_tokens,
    actual_output_tokens = @actual_output_tokens,
    actual_cache_creation_tokens = @actual_cache_creation_tokens,
    actual_cache_read_tokens = @actual_cache_read_tokens,
    actual_total_tokens = @actual_total_tokens,
    estimated_cost = @estimated_cost,
    calculated_cost = @calculated_cost
  WHERE id = @id
`;

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly db: Database.Database) {}

  create(task: Task, budget: TokenBudget): void {
    try {
      this.db.prepare<TaskRow>(INSERT_SQL).run(taskToRow(task, budget));
    } catch (error) {
      translateSqliteError(error, 'Task', task.id);
    }
  }

  findById(id: TaskId): Task | null {
    const row = this.db.prepare<[TaskId], TaskRow>('SELECT * FROM tasks WHERE id = ?').get(id);
    return row === undefined ? null : rowToTask(row);
  }

  findBudgetByTaskId(id: TaskId): TokenBudget | null {
    const row = this.db.prepare<[TaskId], TaskRow>('SELECT * FROM tasks WHERE id = ?').get(id);
    return row === undefined ? null : rowToBudget(row);
  }

  update(task: Task): void {
    const result = this.db
      .prepare<{ id: string; state: string; branch_name: string | null; retry_count: number; updated_at: string }>(
        UPDATE_TASK_SQL
      )
      .run({
        id: task.id,
        state: task.state,
        branch_name: task.branchName,
        retry_count: task.retryCount,
        updated_at: task.updatedAt
      });
    if (result.changes === 0) {
      throw new NotFoundError('Task', task.id);
    }
  }

  updateBudget(budget: TokenBudget): void {
    const result = this.db
      .prepare<BudgetRowFields & { id: string }>(UPDATE_BUDGET_SQL)
      .run({ id: budget.taskId, ...budgetToRowFields(budget) });
    if (result.changes === 0) {
      throw new NotFoundError('Task', budget.taskId);
    }
  }

  list(): readonly Task[] {
    const rows = this.db.prepare<[], TaskRow>('SELECT * FROM tasks ORDER BY created_at ASC').all();
    return rows.map(rowToTask);
  }

  listByProject(projectId: ProjectId): readonly Task[] {
    const rows = this.db
      .prepare<[ProjectId], TaskRow>('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId);
    return rows.map(rowToTask);
  }
}
