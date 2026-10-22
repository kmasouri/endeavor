// A provider-neutral way to run one model turn with tools. Each provider has its own client
// (Anthropic, OpenAI, a scripted fake for tests), and the runner only sees this interface, so
// adding a provider never changes how collaboration works.

import { ModelProvider } from '../../shared/types';

export interface ModelToolDefinition {
  name: string;
  description: string;
  // JSON Schema for the tool's input.
  inputSchema: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ModelToolResult {
  callId: string;
  content: string;
  isError: boolean;
}

// One entry in a task's model transcript. Assistant turns keep the provider's own content in
// raw and are sent back unchanged, which some providers need (for example, Claude's thinking
// blocks). The transcript only ever grows: entries are never edited.
export type ModelTranscriptEntry =
  | { role: 'user'; text: string }
  | { role: 'assistant'; raw: unknown }
  | { role: 'tool_results'; results: ModelToolResult[] };

export interface ModelTurnRequest {
  model: string;
  system: string;
  transcript: ModelTranscriptEntry[];
  tools: ModelToolDefinition[];
  maxTokens: number;
}

// end: the model finished its turn. tool_use: it wants tools run. max_tokens: it was cut off.
// refusal: the provider declined the request.
export type ModelStopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal';

export interface ModelTurnResult {
  text: string;
  toolCalls: ModelToolCall[];
  stopReason: ModelStopReason;
  // The assistant turn to append to the transcript as is.
  raw: unknown;
  usage: { inputTokens: number; outputTokens: number };
  // The model that answered. It can differ from the request, such as after a fallback.
  servedModel: string;
}

export interface ModelClient {
  readonly provider: ModelProvider;
  complete(request: ModelTurnRequest): Promise<ModelTurnResult>;
}

// Thrown for any provider failure: bad credentials, rate limits, network errors, bad responses.
// retryable tells the runner whether trying again later could help.
export class ModelClientError extends Error {
  constructor(
    message: string,
    public readonly provider: ModelProvider,
    public readonly retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'ModelClientError';
  }
}
