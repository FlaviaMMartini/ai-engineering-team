import type Database from 'better-sqlite3';
import type { AgentExecutionId, Currency, LLMRequest, LLMRequestId, LLMRequestPurpose, TaskId } from '@aet/domain';
import { NotFoundError, translateSqliteError } from '../errors.js';

export interface LLMRequestRow {
  id: string;
  task_id: string;
  agent_execution_id: string;
  provider: string;
  provider_model: string;
  purpose: string;
  started_at: string;
  completed_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  total_tokens: number | null;
  provider_reported_usage: string | null;
  estimated_cost: number | null;
  calculated_cost: number | null;
  pricing_version: string | null;
  currency: string | null;
}

export function llmRequestToRow(request: LLMRequest): LLMRequestRow {
  return {
    id: request.id,
    task_id: request.taskId,
    agent_execution_id: request.agentExecutionId,
    provider: request.provider,
    provider_model: request.providerModel,
    purpose: request.purpose,
    started_at: request.startedAt,
    completed_at: request.completedAt,
    input_tokens: request.normalizedUsage.inputTokens,
    output_tokens: request.normalizedUsage.outputTokens,
    cache_creation_tokens: request.normalizedUsage.cacheCreationTokens,
    cache_read_tokens: request.normalizedUsage.cacheReadTokens,
    total_tokens: request.normalizedUsage.totalTokens,
    provider_reported_usage:
      request.providerReportedUsage === null ? null : JSON.stringify(request.providerReportedUsage),
    estimated_cost: request.cost?.estimatedCost ?? null,
    calculated_cost: request.cost?.calculatedCost ?? null,
    pricing_version: request.cost?.pricingVersion ?? null,
    currency: request.cost?.currency ?? null
  };
}

export function rowToLLMRequest(row: LLMRequestRow): LLMRequest {
  return {
    id: row.id,
    taskId: row.task_id,
    agentExecutionId: row.agent_execution_id,
    provider: row.provider,
    providerModel: row.provider_model,
    purpose: row.purpose as LLMRequestPurpose,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    normalizedUsage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      cacheReadTokens: row.cache_read_tokens,
      totalTokens: row.total_tokens
    },
    providerReportedUsage:
      row.provider_reported_usage === null ? null : (JSON.parse(row.provider_reported_usage) as Record<string, unknown>),
    cost:
      row.estimated_cost === null && row.calculated_cost === null && row.pricing_version === null && row.currency === null
        ? null
        : {
            estimatedCost: row.estimated_cost,
            calculatedCost: row.calculated_cost,
            pricingVersion: row.pricing_version,
            currency: (row.currency ?? 'USD') as Currency
          }
  };
}

export interface LLMRequestRepository {
  create(request: LLMRequest): void;
  findById(id: LLMRequestId): LLMRequest | null;
  findByTaskId(taskId: TaskId): readonly LLMRequest[];
  findByAgentExecutionId(agentExecutionId: AgentExecutionId): readonly LLMRequest[];
  update(request: LLMRequest): void;
}

const INSERT_SQL = `
  INSERT INTO llm_requests (
    id, task_id, agent_execution_id, provider, provider_model, purpose, started_at, completed_at,
    input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_tokens,
    provider_reported_usage, estimated_cost, calculated_cost, pricing_version, currency
  ) VALUES (
    @id, @task_id, @agent_execution_id, @provider, @provider_model, @purpose, @started_at, @completed_at,
    @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens, @total_tokens,
    @provider_reported_usage, @estimated_cost, @calculated_cost, @pricing_version, @currency
  )
`;

const UPDATE_SQL = `
  UPDATE llm_requests
  SET completed_at = @completed_at,
      input_tokens = @input_tokens, output_tokens = @output_tokens,
      cache_creation_tokens = @cache_creation_tokens, cache_read_tokens = @cache_read_tokens, total_tokens = @total_tokens,
      provider_reported_usage = @provider_reported_usage,
      estimated_cost = @estimated_cost, calculated_cost = @calculated_cost, pricing_version = @pricing_version, currency = @currency
  WHERE id = @id
`;

export class SqliteLLMRequestRepository implements LLMRequestRepository {
  constructor(private readonly db: Database.Database) {}

  create(request: LLMRequest): void {
    try {
      this.db.prepare<LLMRequestRow>(INSERT_SQL).run(llmRequestToRow(request));
    } catch (error) {
      translateSqliteError(error, 'LLMRequest', request.id);
    }
  }

  findById(id: LLMRequestId): LLMRequest | null {
    const row = this.db.prepare<[LLMRequestId], LLMRequestRow>('SELECT * FROM llm_requests WHERE id = ?').get(id);
    return row === undefined ? null : rowToLLMRequest(row);
  }

  findByTaskId(taskId: TaskId): readonly LLMRequest[] {
    const rows = this.db
      .prepare<[TaskId], LLMRequestRow>('SELECT * FROM llm_requests WHERE task_id = ? ORDER BY started_at ASC')
      .all(taskId);
    return rows.map(rowToLLMRequest);
  }

  findByAgentExecutionId(agentExecutionId: AgentExecutionId): readonly LLMRequest[] {
    const rows = this.db
      .prepare<[AgentExecutionId], LLMRequestRow>('SELECT * FROM llm_requests WHERE agent_execution_id = ? ORDER BY started_at ASC')
      .all(agentExecutionId);
    return rows.map(rowToLLMRequest);
  }

  update(request: LLMRequest): void {
    const row = llmRequestToRow(request);
    const result = this.db.prepare<LLMRequestRow>(UPDATE_SQL).run(row);
    if (result.changes === 0) {
      throw new NotFoundError('LLMRequest', request.id);
    }
  }
}
