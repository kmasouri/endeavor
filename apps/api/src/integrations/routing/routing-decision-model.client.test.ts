import { APICallError, type Experimental_DecisionModel as DecisionModel } from 'ai';
import { RoutingClientError } from './routing.client';
import { RoutingDecisionModelClient } from './routing-decision-model.client';

const researcher = { id: 'a-1', name: 'Researcher', purpose: 'Researches and drafts briefs.' };
const reviewer = { id: 'a-2', name: 'Reviewer', purpose: 'Checks every claim in a brief.' };

function fakeModel(answer: Record<string, unknown>) {
  const doDecide = jest.fn().mockResolvedValue({
    answers: { next: answer },
    usage: { inputTokens: 150, outputTokens: 0 },
    warnings: [],
    response: { modelId: 'gpt-6-luna' }
  });
  const model = {
    specificationVersion: 'v4',
    provider: 'openai.decision',
    modelId: 'gpt-6-luna',
    supportedQuestionTypes: ['choice'],
    doDecide
  } as unknown as DecisionModel;
  return { model, doDecide };
}

describe('RoutingDecisionModelClient', () => {
  it('picks a starter from the given agents, with the model’s probability as confidence', async () => {
    const { model, doDecide } = fakeModel({
      type: 'choice',
      choice: 'agent:Researcher',
      probabilities: { 'agent:Researcher': 0.9, 'agent:Reviewer': 0.04, none: 0.01, ask: 0.05 }
    });
    const client = new RoutingDecisionModelClient(model);

    const decision = await client.chooseStarter({
      message: 'Write a brief on bees.',
      agents: [researcher, reviewer]
    });

    expect(decision.choice).toEqual({ kind: 'agent', agentId: 'a-1' });
    expect(decision.confidence).toBeCloseTo(0.9);
    expect(decision.ranked.map((entry) => entry.choice)).toEqual([
      { kind: 'agent', agentId: 'a-1' },
      { kind: 'ask' },
      { kind: 'agent', agentId: 'a-2' },
      { kind: 'none' }
    ]);
    expect(decision.usage).toEqual({ inputTokens: 150, outputTokens: 0 });
    expect(decision.servedModel).toBe('gpt-6-luna');

    const call = doDecide.mock.calls[0][0];
    expect(Object.keys(call.questions.next.criteria)).toEqual([
      'agent:Researcher',
      'agent:Reviewer',
      'none',
      'ask'
    ]);
    expect(JSON.stringify(call.state)).toContain('Write a brief on bees.');
  });

  it('never offers the agent that just finished as its own next step', async () => {
    const { model, doDecide } = fakeModel({
      type: 'choice',
      choice: 'done',
      probabilities: { 'agent:Reviewer': 0.2, done: 0.7, ask: 0.1 }
    });
    const client = new RoutingDecisionModelClient(model);

    const decision = await client.chooseAfterTask({
      goal: 'Write a brief on bees.',
      finishedAgent: researcher,
      result: 'Here is the final brief.',
      agents: [researcher, reviewer],
      recent: [{ author: 'Reviewer', body: 'Signed off' }]
    });

    expect(decision.choice).toEqual({ kind: 'done' });
    const call = doDecide.mock.calls[0][0];
    expect(Object.keys(call.questions.next.criteria)).toEqual(['agent:Reviewer', 'done', 'ask']);
    expect(JSON.stringify(call.state)).toContain('Signed off');
  });

  it('reports no confidence when the model gives no probabilities', async () => {
    const { model } = fakeModel({ type: 'choice', choice: 'agent:Researcher' });
    const client = new RoutingDecisionModelClient(model);

    const decision = await client.chooseStarter({ message: 'Hi', agents: [researcher] });

    expect(decision.choice).toEqual({ kind: 'agent', agentId: 'a-1' });
    expect(decision.confidence).toBe(0);
  });

  it('wraps provider failures and says whether a retry could help', async () => {
    const { model, doDecide } = fakeModel({});
    doDecide.mockRejectedValue(
      new APICallError({
        message: 'Rate limited',
        url: 'https://api.openai.com/v1/decisions',
        requestBodyValues: {},
        statusCode: 429,
        isRetryable: true
      })
    );
    const client = new RoutingDecisionModelClient(model);

    const failure = client.chooseStarter({ message: 'Hi', agents: [researcher] });

    await expect(failure).rejects.toBeInstanceOf(RoutingClientError);
    await expect(failure).rejects.toMatchObject({ engine: 'decision-model', retryable: true });
  });
});
