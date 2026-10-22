import { ModelScriptedClient } from './model-scripted.client';

describe('ModelScriptedClient', () => {
  it('answers from the script and gives each tool call an ID', async () => {
    const client = new ModelScriptedClient(() => ({
      text: 'On it',
      toolCalls: [{ name: 'send_message', input: { body: 'hi' } }]
    }));

    const result = await client.complete({
      model: 'script',
      system: 's',
      transcript: [{ role: 'user', text: 'go' }],
      tools: [],
      maxTokens: 100
    });

    expect(result).toMatchObject({
      text: 'On it',
      stopReason: 'tool_use',
      toolCalls: [{ id: 'scripted-1', name: 'send_message', input: { body: 'hi' } }]
    });
  });

  it('counts no output for an empty turn', async () => {
    const result = await new ModelScriptedClient().complete({
      model: 'script',
      system: 's',
      transcript: [],
      tools: [],
      maxTokens: 100
    });

    expect(result.usage.outputTokens).toBe(0);
  });
});
