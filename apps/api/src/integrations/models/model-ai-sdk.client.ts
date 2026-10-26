// One ModelClient for every real provider, built on the Vercel AI SDK (`ai`). It runs exactly one
// model turn per call, so the runner keeps its own loop, checks, and records; the SDK only
// handles talking to each provider (CA-29, CA-32).
//
// Assistant turns are saved in the SDK's own message format (raw), which is the same for every
// provider. Turns saved before this client existed are in each provider's own format; the
// runner shows those as text (see transcriptFormat).

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import {
  APICallError,
  generateText,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  type ToolSet
} from 'ai';
import { ModelProvider } from '../../shared/types';
import {
  ModelClient,
  ModelClientError,
  ModelStopReason,
  ModelToolCall,
  ModelTranscriptEntry,
  ModelTurnRequest,
  ModelTurnResult
} from './model.client';

type ProviderOptions = Parameters<typeof generateText>[0]['providerOptions'];

// How one provider is reached: the SDK model for a model name, and any provider options.
export interface AiSdkProvider {
  model(name: string): LanguageModel;
  options?(name: string): ProviderOptions;
}

// OpenAI through its Responses API: its current models only accept tools there. Reasoning comes
// back encrypted inside each turn and nothing is stored at OpenAI, so a task can resume days
// later from our own records. OPENAI_BASE_URL can point at a compatible API.
export function createOpenAiProvider(apiKey: string, baseUrl: string): AiSdkProvider {
  const openai = createOpenAI({ apiKey, baseURL: baseUrl });
  return {
    model: (name) => openai.responses(name),
    options: () => ({ openai: { store: false, include: ['reasoning.encrypted_content'] } })
  };
}

// Models that accept Anthropic's server-side refusal fallback. On these, a declined request is
// re-run on a suitable fallback model inside the same call, instead of just stopping.
const ANTHROPIC_FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5'
]);

export function createAnthropicProvider(apiKey: string): AiSdkProvider {
  const anthropic = createAnthropic({ apiKey });
  return {
    model: (name) => anthropic(name),
    options: (name) =>
      ANTHROPIC_FALLBACK_MODELS.has(name) ? { anthropic: { fallbacks: 'default' } } : undefined
  };
}

export class ModelAiSdkClient implements ModelClient {
  readonly transcriptFormat = 'ai-sdk';

  constructor(
    readonly provider: ModelProvider,
    private readonly sdk: AiSdkProvider
  ) {}

  async complete(request: ModelTurnRequest): Promise<ModelTurnResult> {
    // Tools have no execute function, so the SDK stops after one turn and hands the tool calls
    // back. The runner runs them.
    const tools: ToolSet = Object.fromEntries(
      request.tools.map((tool) => [
        tool.name,
        { description: tool.description, inputSchema: jsonSchema(tool.inputSchema) }
      ])
    );

    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model: this.sdk.model(request.model),
        system: request.system,
        messages: toMessages(request.transcript),
        ...(request.tools.length > 0 && { tools }),
        maxOutputTokens: request.maxTokens,
        providerOptions: this.sdk.options?.(request.model),
        // The runner retries with its own backoff and counts failures.
        maxRetries: 0
      });
    } catch (error) {
      const retryable = APICallError.isInstance(error) ? error.isRetryable : true;
      throw new ModelClientError(
        `${this.provider} call failed: ${(error as Error).message}`,
        this.provider,
        retryable,
        { cause: error }
      );
    }

    const toolCalls: ModelToolCall[] = result.toolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      input: call.input
    }));
    return {
      text: result.text,
      toolCalls,
      stopReason: toStopReason(result.finishReason, toolCalls.length),
      raw: result.response.messages,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0
      },
      servedModel: result.response.modelId ?? request.model
    };
  }
}

function toStopReason(reason: string, toolCallCount: number): ModelStopReason {
  if (toolCallCount > 0) return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content-filter') return 'refusal';
  return 'end';
}

// Our transcript in the SDK's message format. Assistant turns are already SDK messages. Tool
// results need the tool's name, which only the assistant turn that asked for them has.
export function toMessages(transcript: ModelTranscriptEntry[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const entry of transcript) {
    if (entry.role === 'user') {
      messages.push({ role: 'user', content: entry.text });
    } else if (entry.role === 'assistant') {
      for (const message of entry.raw as ModelMessage[]) {
        if (message.role === 'assistant' && Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'tool-call') toolNames.set(part.toolCallId, part.toolName);
          }
        }
        messages.push(message);
      }
    } else {
      messages.push({
        role: 'tool',
        content: entry.results.map((result) => ({
          type: 'tool-result' as const,
          toolCallId: result.callId,
          toolName: toolNames.get(result.callId) ?? 'unknown',
          output: result.isError
            ? { type: 'error-text' as const, value: result.content }
            : { type: 'text' as const, value: result.content }
        }))
      });
    }
  }
  return messages;
}
