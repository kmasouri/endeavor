// What every model-based routing engine shows the model: the options it may pick from, and the
// facts to judge by. Options are keyed by name ("agent:Researcher"), since names are what the
// model reads, and each key maps back to exactly one choice, so a pick outside the given agents
// can't happen.

import {
  HandoffChoice,
  HandoffRequest,
  RoutingAgent,
  RoutingDecision,
  RoutingMessage,
  StarterChoice,
  StarterRequest
} from './routing.client';

export interface RoutingQuestion<CHOICE> {
  instructions: string;
  // Option key -> what it means, for the model.
  options: Record<string, string>;
  // Option key -> the choice it stands for.
  choices: Map<string, CHOICE>;
  // The facts, as JSON.
  state: Record<string, unknown>;
}

export const STARTER_INSTRUCTIONS = [
  'A person posted a message in a shared workspace and tagged no one.',
  'Decide who should act on it.',
  'Pick an agent only if the message asks for work that agent is clearly there to do.',
  'Pick "none" if the message asks for nothing: a greeting, thanks, a status note, or a report for the record.',
  'Pick "ask" if it is a request but more than one agent could fit, or none fits well.'
].join(' ');

export const HANDOFF_INSTRUCTIONS = [
  "An agent just finished its part of the goal and didn't hand off to anyone.",
  'Decide what should happen next.',
  'Pick an agent only if the goal clearly needs a step that agent is there to do and that has not happened yet.',
  'Pick "done" if the goal is met, or the result was delivered to the person who asked.',
  'Pick "ask" if a person must act (for example, to approve, raise a limit, or fix access), or if it is unclear.'
].join(' ');

export function starterQuestion(request: StarterRequest): RoutingQuestion<StarterChoice> {
  const options: Record<string, string> = {};
  const choices = new Map<string, StarterChoice>();
  for (const agent of request.agents) {
    options[agentKey(agent)] = agent.purpose;
    choices.set(agentKey(agent), { kind: 'agent', agentId: agent.id });
  }
  options.none = 'Nothing should run: the message asks for nothing.';
  choices.set('none', { kind: 'none' });
  options.ask = 'A person should pick who acts.';
  choices.set('ask', { kind: 'ask' });
  return {
    instructions: STARTER_INSTRUCTIONS,
    options,
    choices,
    state: {
      message: request.message,
      agents: request.agents.map(describe),
      ...recentMessages(request.recent)
    }
  };
}

export function handoffQuestion(request: HandoffRequest): RoutingQuestion<HandoffChoice> {
  const options: Record<string, string> = {};
  const choices = new Map<string, HandoffChoice>();
  // The agent that just finished can't be its own next step.
  for (const agent of request.agents.filter((agent) => agent.id !== request.finishedAgent.id)) {
    options[agentKey(agent)] = agent.purpose;
    choices.set(agentKey(agent), { kind: 'agent', agentId: agent.id });
  }
  options.done = 'The goal is met. Nothing more should run.';
  choices.set('done', { kind: 'done' });
  options.ask = 'A person should decide what happens next.';
  choices.set('ask', { kind: 'ask' });
  return {
    instructions: HANDOFF_INSTRUCTIONS,
    options,
    choices,
    state: {
      goal: request.goal,
      finishedAgent: describe(request.finishedAgent),
      result: request.result,
      agents: request.agents.map(describe),
      ...recentMessages(request.recent)
    }
  };
}

// Turns option probabilities into a decision. Unknown keys are dropped, and probabilities are
// scaled to add up to 1. With nothing usable, the decision is "ask" with no confidence.
export function toDecision<CHOICE>(
  question: RoutingQuestion<CHOICE>,
  probabilities: Record<string, number>,
  fallback: CHOICE,
  extra: Pick<RoutingDecision<CHOICE>, 'usage' | 'servedModel'>
): RoutingDecision<CHOICE> {
  const known = Object.entries(probabilities).filter(
    ([key, value]) => question.choices.has(key) && Number.isFinite(value) && value > 0
  );
  const total = known.reduce((sum, [, value]) => sum + value, 0);
  const ranked = known
    .map(([key, value]) => ({ choice: question.choices.get(key)!, probability: value / total }))
    .sort((a, b) => b.probability - a.probability);
  if (ranked.length === 0) {
    return { choice: fallback, confidence: 0, ranked: [], ...extra };
  }
  return { choice: ranked[0].choice, confidence: ranked[0].probability, ranked, ...extra };
}

function agentKey(agent: RoutingAgent): string {
  return `agent:${agent.name}`;
}

function describe(agent: RoutingAgent) {
  return { name: agent.name, purpose: agent.purpose };
}

function recentMessages(recent: RoutingMessage[] | undefined) {
  if (!recent || recent.length === 0) return {};
  return {
    recentMessages: recent.map((message) => ({ author: message.author, body: message.body }))
  };
}
