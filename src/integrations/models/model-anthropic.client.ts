import Anthropic from '@anthropic-ai/sdk';
import {
  ModelClient,
  ModelClientError,
  ModelStopReason,
  ModelTranscriptEntry,
  ModelTurnRequest,
  ModelTurnResult
} from './model.client';

// Models that accept the server-side refusal fallback. On these, a declined request is re-run on
// a suitable fallback model inside the same call, instead of just stopping.
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5'
]);

export class ModelAnthropicClient implements ModelClient {
  readonly provider = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async complete(request: ModelTurnRequest): Promise<ModelTurnResult> {
    const useFallback = FALLBACK_MODELS.has(request.model);
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: toMessages(request.transcript),
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema
        })),
        ...(useFallback && {
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default' as const
        })
      });
    } catch (error) {
      throw toModelError(error);
    }

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const toolCalls = response.content
      .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));

    return {
      text,
      toolCalls,
      stopReason: toStopReason(response.stop_reason, toolCalls.length),
      raw: response.content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      },
      servedModel: response.model
    };
  }
}

function toMessages(transcript: ModelTranscriptEntry[]): Anthropic.Beta.BetaMessageParam[] {
  return transcript.map((entry) => {
    switch (entry.role) {
      case 'user':
        return { role: 'user', content: entry.text };
      case 'assistant':
        return { role: 'assistant', content: entry.raw as Anthropic.Beta.BetaContentBlockParam[] };
      case 'tool_results':
        // All results for one assistant turn go back in a single user message.
        return {
          role: 'user',
          content: entry.results.map((result) => ({
            type: 'tool_result' as const,
            tool_use_id: result.callId,
            content: result.content,
            is_error: result.isError
          }))
        };
    }
  });
}

function toStopReason(stopReason: string | null, toolCallCount: number): ModelStopReason {
  if (stopReason === 'refusal') {
    return 'refusal';
  }
  if (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded') {
    return 'max_tokens';
  }
  return stopReason === 'tool_use' && toolCallCount > 0 ? 'tool_use' : 'end';
}

function toModelError(error: unknown): ModelClientError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new ModelClientError(
      `Anthropic rejected the API key: ${error.message}`,
      'anthropic',
      false,
      {
        cause: error
      }
    );
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new ModelClientError(
      `Anthropic rejected the request: ${error.message}`,
      'anthropic',
      false,
      {
        cause: error
      }
    );
  }
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
    return new ModelClientError(
      `Anthropic is busy or failing: ${error.message}`,
      'anthropic',
      true,
      {
        cause: error
      }
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ModelClientError(`Could not reach Anthropic: ${error.message}`, 'anthropic', true, {
      cause: error
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new ModelClientError(`Anthropic error: ${error.message}`, 'anthropic', false, {
      cause: error
    });
  }
  return new ModelClientError(
    `Anthropic call failed: ${(error as Error).message}`,
    'anthropic',
    false,
    {
      cause: error
    }
  );
}
