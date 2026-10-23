import Anthropic from '@anthropic-ai/sdk';
import { ModelAnthropicClient } from './model-anthropic.client';
import { ModelTurnRequest } from './model.client';

function fakeSdk(create: jest.Mock): Anthropic {
  return { beta: { messages: { create } } } as unknown as Anthropic;
}

const request: ModelTurnRequest = {
  model: 'claude-opus-5-5',
  system: 'You are a researcher.',
  maxTokens: 16000,
  tools: [{ name: 'send_message', description: 'Post', inputSchema: { type: 'object' } }],
  transcript: [
    { role: 'user', text: 'Summarize the docs' },
    { role: 'assistant', raw: [{ type: 'tool_use', id: 't1', name: 'send_message', input: {} }] },
    { role: 'tool_results', results: [{ callId: 't1', content: 'posted', isError: false }] }
  ]
};

describe('ModelAnthropicClient', () => {
  it('sends the transcript, tools, and refusal fallback, and reads tool calls back', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'claude-opus-5-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Asking the reviewer.' },
        { type: 'tool_use', id: 't2', name: 'send_message', input: { body: 'hi' } }
      ],
      usage: { input_tokens: 120, output_tokens: 30 }
    });

    const result = await new ModelAnthropicClient('key', fakeSdk(create)).complete(request);

    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: 'You are a researcher.',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: [{ name: 'send_message', input_schema: { type: 'object' } }]
    });
    expect(params.messages).toEqual([
      { role: 'user', content: 'Summarize the docs' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'send_message', input: {} }]
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'posted', is_error: false }]
      }
    ]);
    expect(result).toMatchObject({
      text: 'Asking the reviewer.',
      toolCalls: [{ id: 't2', name: 'send_message', input: { body: 'hi' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 120, outputTokens: 30 }
    });
  });

  it('leaves out the fallback for models that do not support it', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Done' }],
      usage: { input_tokens: 1, output_tokens: 1 }
    });

    await new ModelAnthropicClient('key', fakeSdk(create)).complete({
      ...request,
      model: 'claude-haiku-5-5'
    });

    expect(create.mock.calls[0][0]).not.toHaveProperty('fallbacks');
  });

  it('reports refusals', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'claude-opus-5-5',
      stop_reason: 'refusal',
      content: [],
      usage: { input_tokens: 1, output_tokens: 0 }
    });

    const result = await new ModelAnthropicClient('key', fakeSdk(create)).complete(request);

    expect(result.stopReason).toBe('refusal');
  });

  it('marks rate limits as retryable and bad keys as not', async () => {
    const rateLimited = new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers());
    const badKey = new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers());

    await expect(
      new ModelAnthropicClient('key', fakeSdk(jest.fn().mockRejectedValue(rateLimited))).complete(
        request
      )
    ).rejects.toMatchObject({ provider: 'anthropic', retryable: true });
    await expect(
      new ModelAnthropicClient('key', fakeSdk(jest.fn().mockRejectedValue(badKey))).complete(
        request
      )
    ).rejects.toMatchObject({ provider: 'anthropic', retryable: false });
  });
});
