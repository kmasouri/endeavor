import {
  ModelClient,
  ModelClientError,
  ModelStopReason,
  ModelToolCall,
  ModelTranscriptEntry,
  ModelTurnRequest,
  ModelTurnResult
} from './model.client';

// Calls the OpenAI Chat Completions API with fetch. The assistant message is kept whole in raw
// and sent back as is.

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  refusal?: string | null;
}

interface OpenAIResponse {
  model: string;
  choices: { message: OpenAIAssistantMessage; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

type OpenAIMessage =
  | { role: 'system' | 'user'; content: string }
  | OpenAIAssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

export class ModelOpenAIClient implements ModelClient {
  readonly provider = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    baseUrl: string = 'https://api.openai.com/v1'
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private readonly baseUrl: string;

  async complete(request: ModelTurnRequest): Promise<ModelTurnResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: request.model,
          max_completion_tokens: request.maxTokens,
          messages: toMessages(request.system, request.transcript),
          ...(request.tools.length > 0 && {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
              }
            }))
          })
        })
      });
    } catch (error) {
      throw new ModelClientError(
        `Could not reach OpenAI: ${(error as Error).message}`,
        'openai',
        true,
        {
          cause: error
        }
      );
    }

    if (!response.ok) {
      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      throw new ModelClientError(
        `OpenAI returned ${response.status}: ${body.slice(0, 500)}`,
        'openai',
        retryable
      );
    }

    let data: OpenAIResponse;
    try {
      data = (await response.json()) as OpenAIResponse;
    } catch (error) {
      throw new ModelClientError('OpenAI returned a body that is not JSON', 'openai', true, {
        cause: error
      });
    }
    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    if (!choice?.message) {
      throw new ModelClientError('OpenAI returned no choices', 'openai', true);
    }

    const toolCalls = (choice.message.tool_calls ?? []).map(toToolCall);
    return {
      text: choice.message.content ?? '',
      toolCalls,
      stopReason: toStopReason(choice, toolCalls.length),
      // Only the fields a request accepts, so strict compatible APIs take it back.
      raw: {
        role: 'assistant',
        content: choice.message.content ?? null,
        ...(choice.message.tool_calls?.length && { tool_calls: choice.message.tool_calls })
      },
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0
      },
      servedModel: data.model
    };
  }
}

function toMessages(system: string, transcript: ModelTranscriptEntry[]): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [{ role: 'system', content: system }];
  for (const entry of transcript) {
    if (entry.role === 'user') {
      messages.push({ role: 'user', content: entry.text });
    } else if (entry.role === 'assistant') {
      messages.push(entry.raw as OpenAIAssistantMessage);
    } else {
      for (const result of entry.results) {
        messages.push({
          role: 'tool',
          tool_call_id: result.callId,
          content: result.isError ? `Error: ${result.content}` : result.content
        });
      }
    }
  }
  return messages;
}

// A tool call whose arguments aren't valid JSON keeps the raw string, so the runner can report
// the bad input back to the model instead of crashing.
function toToolCall(call: OpenAIToolCall): ModelToolCall {
  let input: unknown;
  try {
    input = JSON.parse(call.function.arguments);
  } catch {
    input = { invalidJson: call.function.arguments };
  }
  return { id: call.id, name: call.function.name, input };
}

function toStopReason(
  choice: OpenAIResponse['choices'][number],
  toolCallCount: number
): ModelStopReason {
  if (choice.message.refusal || choice.finish_reason === 'content_filter') {
    return 'refusal';
  }
  if (choice.finish_reason === 'length') {
    return 'max_tokens';
  }
  return toolCallCount > 0 ? 'tool_use' : 'end';
}
