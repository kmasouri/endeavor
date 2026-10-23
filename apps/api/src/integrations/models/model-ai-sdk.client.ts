// CA-29 spike: one ModelClient for every provider, built on the Vercel AI SDK (`ai`). It runs
// exactly one model turn, like the hand-written OpenAI and Anthropic clients, so the runner keeps
// its own loop, checks, and records. The SDK only replaces the provider-specific code.
//
// Assistant turns are kept in the SDK's own message format (raw), which is the same for every
// provider. That's what makes one client enough.

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

// Builds the SDK model for a model name, such as `openai.chat(name)` from @ai-sdk/openai.
export type AiSdkModelFactory = (model: string) => LanguageModel;

// OpenAI through its Chat Completions API, so OPENAI_BASE_URL can point at a compatible API, as
// with the hand-written client.
export function openAiSdkModels(apiKey: string, baseUrl: string): AiSdkModelFactory {
  const openai = createOpenAI({ apiKey, baseURL: baseUrl });
  return (model) => openai.chat(model);
}

export function anthropicSdkModels(apiKey: string): AiSdkModelFactory {
  const anthropic = createAnthropic({ apiKey });
  return (model) => anthropic(model);
}

export class ModelAiSdkClient implements ModelClient {
  constructor(
    readonly provider: ModelProvider,
    private readonly modelFor: AiSdkModelFactory
  ) {}

  async complete(request: ModelTurnRequest): Promise<ModelTurnResult> {
    // Tools have no execute function, so the SDK stops after one turn and hands the tool calls
    // back. The runner runs them, as it does for the other clients.
    const tools: ToolSet = Object.fromEntries(
      request.tools.map((tool) => [
        tool.name,
        { description: tool.description, inputSchema: jsonSchema(tool.inputSchema) }
      ])
    );

    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model: this.modelFor(request.model),
        system: request.system,
        messages: toMessages(request.transcript),
        tools,
        maxOutputTokens: request.maxTokens,
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
