import type Anthropic from '@anthropic-ai/sdk';
import { calculateTotalTokens, type TokenUsage } from '@aet/domain';
import type { LLMFinishReason, LLMGenerationRequest, LLMMessage, LLMResponse, LLMToolDefinition } from '../types.js';

const PROVIDER_NAME = 'anthropic';

function toAnthropicMessages(messages: readonly LLMMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function toAnthropicTools(tools: readonly LLMToolDefinition[] | undefined): Anthropic.Tool[] | undefined {
  if (tools === undefined || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

/** Everything provider-specific about *building* the request lives here — nowhere else touches Anthropic's param shape. */
export function toAnthropicRequest(request: LLMGenerationRequest): Anthropic.MessageCreateParamsNonStreaming {
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    messages: toAnthropicMessages(request.messages)
  };

  if (request.systemPrompt !== null) {
    params.system = request.systemPrompt;
  }
  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }
  const tools = toAnthropicTools(request.tools);
  if (tools !== undefined) {
    params.tools = tools;
  }

  return params;
}

function mapFinishReason(stopReason: Anthropic.Message['stop_reason']): LLMFinishReason {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'max_tokens';
    case 'tool_use':
      return 'tool_use';
    default:
      return 'unknown';
  }
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' ? value : null;
}

/**
 * SDK 0.32.1's stable `Usage` type only declares `input_tokens`/
 * `output_tokens` — cache fields exist only under its beta namespace's
 * types. Anthropic's actual API response may still include
 * `cache_creation_input_tokens`/`cache_read_input_tokens` at runtime
 * regardless of what this SDK version's stable types declare, so both are
 * read defensively from the raw object rather than assumed absent. Never
 * fabricated: truly absent stays null, exactly like every other
 * unsupported-by-this-response field in the codebase.
 */
function toNormalizedUsage(rawUsage: Record<string, unknown>): TokenUsage {
  const inputTokens = readOptionalNumber(rawUsage, 'input_tokens');
  const outputTokens = readOptionalNumber(rawUsage, 'output_tokens');
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens: readOptionalNumber(rawUsage, 'cache_creation_input_tokens'),
    cacheReadTokens: readOptionalNumber(rawUsage, 'cache_read_input_tokens'),
    totalTokens: calculateTotalTokens(inputTokens, outputTokens)
  };
}

function extractText(content: Anthropic.Message['content']): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/** Everything provider-specific about *reading* the response lives here — the rest of the app only ever sees `LLMResponse`. */
export function fromAnthropicResponse(message: Anthropic.Message): LLMResponse {
  const rawUsage = message.usage as unknown as Record<string, unknown>;

  return {
    provider: PROVIDER_NAME,
    model: message.model,
    text: extractText(message.content),
    finishReason: mapFinishReason(message.stop_reason),
    usage: toNormalizedUsage(rawUsage),
    rawProviderUsage: rawUsage
  };
}
