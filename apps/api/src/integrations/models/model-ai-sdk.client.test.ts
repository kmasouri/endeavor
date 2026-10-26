import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
  createAnthropicProvider,
  ModelAiSdkClient,
  createOpenAiProvider,
  toMessages
} from './model-ai-sdk.client';
import { ModelClientError, ModelTurnRequest } from './model.client';

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 30, text: 30, reasoning: 0 }
};

const request: ModelTurnRequest = {
  model: 'test-model',
  system: 'You are a researcher.',
  transcript: [{ role: 'user', text: 'Find the answer.' }],
  tools: [
    {
      name: 'send_message',
      description: 'Post a message.',
      inputSchema: {
        type: 'object',
        properties: { body: { type: 'string' } },
        required: ['body']
      }
    }
  ],
  maxTokens: 1000
};

describe('ModelAiSdkClient', () => {
  it('returns tool calls without running them, so the runner stays in charge', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          { type: 'text', text: 'Posting now.' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'send_message',
            input: JSON.stringify({ body: 'Hello' })
          }
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage,
        warnings: []
      }
    });
    const client = new ModelAiSdkClient('openai', { model: () => model });

    const result = await client.complete(request);

    expect(result.toolCalls).toEqual([
      { id: 'call-1', name: 'send_message', input: { body: 'Hello' } }
    ]);
    expect(result.text).toBe('Posting now.');
    expect(result.stopReason).toBe('tool_use');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    // One model call: the SDK did not loop.
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(1000);
  });

  it('sends the transcript back in the SDK format, with tool results named', async () => {
    const first = new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'send_message',
            input: '{"body":"Hi"}'
          }
        ],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage,
        warnings: []
      }
    });
    const firstTurn = await new ModelAiSdkClient('openai', { model: () => first }).complete(
      request
    );

    const messages = toMessages([
      ...request.transcript,
      { role: 'assistant', raw: firstTurn.raw },
      { role: 'tool_results', results: [{ callId: 'call-1', content: 'Posted.', isError: false }] }
    ]);

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
    expect(messages[2]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'send_message',
          output: { type: 'text', value: 'Posted.' }
        }
      ]
    });
  });

  it('maps finish reasons', async () => {
    const reply = (unified: 'length' | 'content-filter' | 'stop') =>
      new ModelAiSdkClient('anthropic', {
        model: () =>
          new MockLanguageModelV4({
            doGenerate: {
              content: [{ type: 'text', text: 'x' }],
              finishReason: { unified, raw: undefined },
              usage,
              warnings: []
            }
          })
      }).complete(request);

    expect((await reply('length')).stopReason).toBe('max_tokens');
    expect((await reply('content-filter')).stopReason).toBe('refusal');
    expect((await reply('stop')).stopReason).toBe('end');
  });

  it('turns provider errors into ModelClientError, keeping whether a retry could help', async () => {
    const failing = (isRetryable: boolean) =>
      new ModelAiSdkClient('openai', {
        model: () =>
          new MockLanguageModelV4({
            doGenerate: async () => {
              throw new APICallError({
                message: 'nope',
                url: 'https://example.test',
                requestBodyValues: {},
                statusCode: isRetryable ? 429 : 401,
                isRetryable
              });
            }
          })
      }).complete(request);

    await expect(failing(true)).rejects.toMatchObject({ retryable: true, provider: 'openai' });
    await expect(failing(false)).rejects.toBeInstanceOf(ModelClientError);
    await expect(failing(false)).rejects.toMatchObject({ retryable: false });
  });

  it('passes provider options, such as keeping OpenAI reasoning in our own records', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: 'Hi' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: []
      }
    });
    const openai = createOpenAiProvider('sk-test', 'https://api.openai.com/v1');
    const client = new ModelAiSdkClient('openai', { model: () => model, options: openai.options });

    await client.complete(request);

    expect(model.doGenerateCalls[0].providerOptions).toEqual({
      openai: { store: false, include: ['reasoning.encrypted_content'] }
    });
  });

  it('turns on the Anthropic refusal fallback only for models that accept it', () => {
    const anthropic = createAnthropicProvider('sk-test');
    expect(anthropic.options?.('claude-opus-5-5')).toEqual({ anthropic: { fallbacks: 'default' } });
    expect(anthropic.options?.('claude-haiku-5-5')).toBeUndefined();
  });

  it('uses the OpenAI Responses API', () => {
    const model = createOpenAiProvider('sk-test', 'https://api.openai.com/v1').model('gpt-6-luna');
    expect(typeof model === 'object' && model.provider).toBe('openai.responses');
  });
});
