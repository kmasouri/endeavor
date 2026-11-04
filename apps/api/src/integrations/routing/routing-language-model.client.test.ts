import { MockLanguageModelV4 } from 'ai/test';
import { RoutingClientError } from './routing.client';
import { RoutingLanguageModelClient } from './routing-language-model.client';

const usage = {
  inputTokens: { total: 300, noCache: 300, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 40, text: 40, reasoning: 0 }
};

const checker = { id: 'a-1', name: 'Checker', purpose: 'Checks the API on a schedule.' };
const investigator = { id: 'a-2', name: 'Investigator', purpose: 'Diagnoses broken endpoints.' };

function modelAnswering(probabilities: Record<string, number>) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify({ probabilities }) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: []
    }
  });
}

describe('RoutingLanguageModelClient', () => {
  it('turns the model’s probabilities into a ranked decision that adds up to 1', async () => {
    const model = modelAnswering({ 'agent:Investigator': 3, done: 0.5, ask: 0.5 });
    const client = new RoutingLanguageModelClient(model);

    const decision = await client.chooseAfterTask({
      goal: 'Report broken endpoints with their likely cause.',
      finishedAgent: checker,
      result: 'GET /api/products returned HTTP 500.',
      agents: [checker, investigator]
    });

    expect(decision.choice).toEqual({ kind: 'agent', agentId: 'a-2' });
    expect(decision.confidence).toBeCloseTo(0.75);
    expect(decision.ranked).toHaveLength(3);
    expect(decision.usage).toEqual({ inputTokens: 300, outputTokens: 40 });
  });

  it('asks a person, with no confidence, when every probability is zero', async () => {
    const model = modelAnswering({ 'agent:Checker': 0, 'agent:Investigator': 0, none: 0, ask: 0 });
    const client = new RoutingLanguageModelClient(model);

    const decision = await client.chooseStarter({
      message: 'Thanks!',
      agents: [checker, investigator]
    });

    expect(decision).toMatchObject({ choice: { kind: 'ask' }, confidence: 0, ranked: [] });
  });

  it('wraps failures, including answers in the wrong shape', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: 'not json' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: []
      }
    });
    const client = new RoutingLanguageModelClient(model);

    await expect(client.chooseStarter({ message: 'Hi', agents: [checker] })).rejects.toBeInstanceOf(
      RoutingClientError
    );
  });
});
