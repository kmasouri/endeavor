import { MockLanguageModelV4 } from 'ai/test';
import { AgentLoopAiSdkClient, AgentLoopHooks, AgentLoopRequest } from './agent-loop-ai-sdk.client';

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 }
};

type Call = { name: string; input: Record<string, unknown> };

// A model that answers each call with the next list of tool calls.
function scriptedModel(turns: Call[][]) {
  let index = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const calls = turns[index++] ?? [];
      return {
        content: calls.length
          ? calls.map((call, i) => ({
              type: 'tool-call' as const,
              toolCallId: `t${index}-${i}`,
              toolName: call.name,
              input: JSON.stringify(call.input)
            }))
          : [{ type: 'text' as const, text: 'Done.' }],
        finishReason: { unified: calls.length ? 'tool-calls' : 'stop', raw: undefined },
        usage,
        warnings: []
      };
    }
  });
}

const tool = (name: string) => ({
  name,
  description: name,
  inputSchema: { type: 'object', properties: {}, additionalProperties: true }
});

const request: AgentLoopRequest = {
  model: 'test-model',
  system: 'You are an agent.',
  transcript: [{ role: 'user', text: 'Do the task.' }],
  tools: [tool('send_message'), tool('ask'), tool('complete_task')],
  stoppingTools: ['ask', 'complete_task', 'report_blocked'],
  maxTokens: 1000,
  maxSteps: 10
};

// Records every hook call, in order.
function recordingHooks(overrides: Partial<AgentLoopHooks> = {}) {
  const log: string[] = [];
  const hooks: AgentLoopHooks = {
    beforeModelCall: async (step) => {
      log.push(`before ${step}`);
    },
    onModelTurn: async (turn) => {
      log.push(`turn ${turn.toolCalls.map((call) => call.name).join(',') || 'text'}`);
    },
    runTool: async (call) => {
      log.push(`tool ${call.name}`);
      return { content: `${call.name} ok`, isError: false, stop: false };
    },
    onToolResults: async (results) => {
      log.push(`results ${results.length}`);
    },
    ...overrides
  };
  return { log, hooks };
}

describe('AgentLoopAiSdkClient (CA-29 spike)', () => {
  it('runs a tool, gives the model its result, and goes on, saving each turn before its tools', async () => {
    const model = scriptedModel([
      [{ name: 'send_message', input: { body: 'Working on it' } }],
      [{ name: 'complete_task', input: { result: 'Answer' } }]
    ]);
    const { log, hooks } = recordingHooks();

    const end = await new AgentLoopAiSdkClient(() => model).run(request, hooks);

    expect(end).toBe('stopped_by_tool');
    expect(log).toEqual([
      'before 0',
      'turn send_message',
      'tool send_message',
      'results 1',
      'before 1',
      'turn complete_task',
      'tool complete_task',
      'results 1'
    ]);
    expect(model.doGenerateCalls).toHaveLength(2);
    // The second call carried the first tool's result.
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain('send_message ok');
  });

  it('stops after ask, with no further model call, so the task can wait', async () => {
    const model = scriptedModel([
      [{ name: 'ask', input: { to: 'Reviewer', question: 'Is this right?' } }],
      [{ name: 'send_message', input: { body: 'should never happen' } }]
    ]);
    const { log, hooks } = recordingHooks();

    const end = await new AgentLoopAiSdkClient(() => model).run(request, hooks);

    expect(end).toBe('stopped_by_tool');
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(log).not.toContain('tool send_message');
  });

  it('runs tools one at a time and skips the rest after a tool that ends the turn', async () => {
    const model = scriptedModel([
      [
        { name: 'send_message', input: {} },
        { name: 'ask', input: {} },
        { name: 'send_message', input: {} }
      ]
    ]);
    const results: string[] = [];
    const { log, hooks } = recordingHooks({
      onToolResults: async (stepResults) => {
        results.push(...stepResults.map((result) => result.content));
      }
    });

    await new AgentLoopAiSdkClient(() => model).run(request, hooks);

    expect(log.filter((line) => line.startsWith('tool'))).toEqual([
      'tool send_message',
      'tool ask'
    ]);
    expect(results[2]).toMatch(/^Skipped/);
  });

  it('makes no model call when the check before it fails, such as a pause', async () => {
    const model = scriptedModel([[{ name: 'send_message', input: {} }]]);
    const { hooks } = recordingHooks({
      beforeModelCall: async () => {
        throw new Error('Task is paused');
      }
    });

    await expect(new AgentLoopAiSdkClient(() => model).run(request, hooks)).rejects.toThrow(
      'Task is paused'
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('runs no tool and stops when the turn could not be saved, even though the SDK swallows the error', async () => {
    const model = scriptedModel([
      [{ name: 'send_message', input: { body: 'Hello' } }],
      [{ name: 'send_message', input: { body: 'Hello again' } }]
    ]);
    const { log, hooks } = recordingHooks({
      onModelTurn: async () => {
        throw new Error('database down');
      }
    });

    const end = await new AgentLoopAiSdkClient(() => model).run(request, hooks);

    expect(end).toBe('turn_not_saved');
    expect(log.some((line) => line.startsWith('tool'))).toBe(false);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
