import { ModelOpenAIClient } from './model-openai.client';
import { ModelTurnRequest } from './model.client';

const request: ModelTurnRequest = {
  model: 'gpt-test',
  system: 'You are a reviewer.',
  maxTokens: 4000,
  tools: [{ name: 'complete_task', description: 'Finish', inputSchema: { type: 'object' } }],
  transcript: [
    { role: 'user', text: 'Check this' },
    {
      role: 'assistant',
      raw: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }]
      }
    },
    { role: 'tool_results', results: [{ callId: 'c1', content: 'nope', isError: true }] }
  ]
};

function mockFetch(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  );
}

describe('ModelOpenAIClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends chat messages with tools and reads tool calls back', async () => {
    const fetchMock = mockFetch(200, {
      model: 'gpt-test',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c2',
                type: 'function',
                function: { name: 'complete_task', arguments: '{"a":1}' }
              }
            ]
          }
        }
      ],
      usage: { prompt_tokens: 50, completion_tokens: 5 }
    });

    const result = await new ModelOpenAIClient('key', 'https://example.test/v1').complete(request);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/v1/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a reviewer.' },
      { role: 'user', content: 'Check this' },
      request.transcript[1].role === 'assistant' ? request.transcript[1].raw : null,
      { role: 'tool', tool_call_id: 'c1', content: 'Error: nope' }
    ]);
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: { name: 'complete_task', description: 'Finish', parameters: { type: 'object' } }
    });
    expect(result).toMatchObject({
      stopReason: 'tool_use',
      toolCalls: [{ id: 'c2', name: 'complete_task', input: { a: 1 } }],
      usage: { inputTokens: 50, outputTokens: 5 }
    });
  });

  it('keeps tool arguments that are not valid JSON', async () => {
    mockFetch(200, {
      model: 'gpt-test',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c3', type: 'function', function: { name: 'x', arguments: '{bad' } }]
          }
        }
      ]
    });

    const result = await new ModelOpenAIClient('key').complete(request);

    expect(result.toolCalls[0].input).toEqual({ invalidJson: '{bad' });
  });

  it('marks 429 as retryable and 401 as not', async () => {
    mockFetch(429, { error: 'slow' });
    await expect(new ModelOpenAIClient('key').complete(request)).rejects.toMatchObject({
      retryable: true
    });

    mockFetch(401, { error: 'bad key' });
    await expect(new ModelOpenAIClient('key').complete(request)).rejects.toMatchObject({
      retryable: false
    });
  });
});
