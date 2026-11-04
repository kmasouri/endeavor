// Compares routing engines on a labeled set of cases (CA-11). It is a one-off measuring tool,
// not part of the app:
//
//   npm run routing:eval -w apps/api -- <cases.json> [engine ...]
//
// Engines are "decision:<model>" (a decision model, like gpt-6-luna) or "language:<model>" (an
// ordinary model asked for probabilities). It uses OPENAI_API_KEY and OPENAI_BASE_URL, and
// MODEL_PRICES for cost. Each case is one call, so a run costs a few cents.
//
// A case file has "starter" cases (a message that tags no one) and "handoff" cases (a task that
// ended without a handoff). "expect" is the right answer: an agent's name, "none", "done", or
// "ask". "also" lists other answers that are acceptable. A handoff case can add "recent"
// messages ({author, body}) for context the decision needs.

import { readFileSync } from 'node:fs';
import { config } from './config';
import {
  createOpenAiDecisionModel,
  createOpenAiRoutingModel,
  HandoffChoice,
  RoutingAgent,
  RoutingClient,
  RoutingDecision,
  RoutingDecisionModelClient,
  RoutingLanguageModelClient,
  StarterChoice
} from './integrations';

interface CaseAgent {
  name: string;
  purpose: string;
}

interface StarterCase {
  id: string;
  source: string;
  agents: CaseAgent[];
  message: string;
  expect: string;
  also: string[];
}

interface HandoffCase {
  id: string;
  source: string;
  agents: CaseAgent[];
  goal: string;
  finished: string;
  result: string;
  recent?: { author: string; body: string }[];
  expect: string;
  also: string[];
}

interface Outcome {
  id: string;
  kind: 'starter' | 'handoff';
  expect: string;
  got: string;
  right: boolean;
  confidence: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

async function main() {
  const [casesPath, ...engineArgs] = process.argv.slice(2);
  if (!casesPath) throw new Error('Usage: routing-eval <cases.json> [engine ...]');
  if (!config.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY.');
  const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as {
    starter: StarterCase[];
    handoff: HandoffCase[];
  };
  const engines = engineArgs.length > 0 ? engineArgs : ['decision:gpt-6-luna'];

  for (const engine of engines) {
    const client = buildClient(engine, config.OPENAI_API_KEY, config.OPENAI_BASE_URL);
    const outcomes = await runAll(client, cases);
    report(engine, outcomes);
  }
}

function buildClient(engine: string, apiKey: string, baseUrl: string): RoutingClient {
  const [kind, model] = engine.split(':');
  if (kind === 'decision') {
    return new RoutingDecisionModelClient(createOpenAiDecisionModel(apiKey, baseUrl, model));
  }
  if (kind === 'language') {
    const { model: languageModel, options } = createOpenAiRoutingModel(apiKey, baseUrl, model);
    return new RoutingLanguageModelClient(languageModel, options);
  }
  throw new Error(`Unknown engine "${engine}". Use decision:<model> or language:<model>.`);
}

async function runAll(
  client: RoutingClient,
  cases: { starter: StarterCase[]; handoff: HandoffCase[] }
): Promise<Outcome[]> {
  const jobs: (() => Promise<Outcome>)[] = [
    ...cases.starter.map((item) => () => runStarter(client, item)),
    ...cases.handoff.map((item) => () => runHandoff(client, item))
  ];
  const outcomes: Outcome[] = [];
  // A few at a time, to stay well under rate limits.
  for (let i = 0; i < jobs.length; i += 4) {
    outcomes.push(...(await Promise.all(jobs.slice(i, i + 4).map((job) => job()))));
  }
  return outcomes;
}

async function runStarter(client: RoutingClient, item: StarterCase): Promise<Outcome> {
  const agents = toAgents(item.agents);
  return measure(item, 'starter', agents, () =>
    client.chooseStarter({ message: item.message, agents })
  );
}

async function runHandoff(client: RoutingClient, item: HandoffCase): Promise<Outcome> {
  const agents = toAgents(item.agents);
  const finishedAgent = agents.find((agent) => agent.name === item.finished);
  if (!finishedAgent) throw new Error(`Case ${item.id}: no agent named ${item.finished}.`);
  return measure(item, 'handoff', agents, () =>
    client.chooseAfterTask({
      goal: item.goal,
      finishedAgent,
      result: item.result,
      agents,
      recent: item.recent
    })
  );
}

async function measure(
  item: { id: string; expect: string; also: string[] },
  kind: Outcome['kind'],
  agents: RoutingAgent[],
  call: () => Promise<RoutingDecision<StarterChoice | HandoffChoice>>
): Promise<Outcome> {
  const started = Date.now();
  try {
    const decision = await call();
    const got = label(decision.choice, agents);
    return {
      id: item.id,
      kind,
      expect: item.expect,
      got,
      right: got === item.expect || item.also.includes(got),
      confidence: decision.confidence,
      ms: Date.now() - started,
      inputTokens: decision.usage.inputTokens,
      outputTokens: decision.usage.outputTokens
    };
  } catch (error) {
    return {
      id: item.id,
      kind,
      expect: item.expect,
      got: 'error',
      right: false,
      confidence: 0,
      ms: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      error: (error as Error).message
    };
  }
}

function toAgents(agents: CaseAgent[]): RoutingAgent[] {
  return agents.map((agent, index) => ({ id: `agent-${index}`, ...agent }));
}

function label(choice: StarterChoice | HandoffChoice, agents: RoutingAgent[]): string {
  if (choice.kind !== 'agent') return choice.kind;
  return agents.find((agent) => agent.id === choice.agentId)?.name ?? 'unknown agent';
}

function report(engine: string, outcomes: Outcome[]) {
  const model = engine.split(':')[1];
  const price = config.MODEL_PRICES[model];
  const inputTokens = sum(outcomes.map((outcome) => outcome.inputTokens));
  const outputTokens = sum(outcomes.map((outcome) => outcome.outputTokens));
  const cost = price
    ? (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1e6
    : undefined;
  const times = outcomes.map((outcome) => outcome.ms).sort((a, b) => a - b);

  console.log(`\n## ${engine}\n`);
  for (const kind of ['starter', 'handoff'] as const) {
    const group = outcomes.filter((outcome) => outcome.kind === kind);
    console.log(`${kind}: ${count(group)} right`);
  }
  console.log(`all: ${count(outcomes)} right`);
  console.log(`errors: ${outcomes.filter((outcome) => outcome.error).length}`);
  console.log(`time per call: median ${pick(times, 0.5)} ms, p90 ${pick(times, 0.9)} ms`);
  console.log(
    `tokens: ${inputTokens} in, ${outputTokens} out, ` +
      (cost === undefined
        ? 'cost unknown (no MODEL_PRICES entry)'
        : `$${cost.toFixed(4)} total, $${((cost / outcomes.length) * 1000).toFixed(3)} per 1,000 decisions`)
  );

  // Calibration: when it says it's this sure, how often is it right?
  console.log('\ncalibration (confidence band: right / calls):');
  for (const [low, high] of [
    [0.95, 1.01],
    [0.8, 0.95],
    [0.6, 0.8],
    [0, 0.6]
  ]) {
    const band = outcomes.filter(
      (outcome) => !outcome.error && outcome.confidence >= low && outcome.confidence < high
    );
    console.log(`  ${low.toFixed(2)}-${Math.min(high, 1).toFixed(2)}: ${count(band)}`);
  }

  // At each threshold, picks below it go to a person instead. "Acted" counts picks that ran on
  // their own (anything but "ask"); a wrong one there is a mistake nobody checked.
  console.log('\nthreshold: acted alone (right/acted), sent to a person');
  for (const threshold of THRESHOLDS) {
    const acted = outcomes.filter(
      (outcome) => !outcome.error && outcome.got !== 'ask' && outcome.confidence >= threshold
    );
    console.log(
      `  ${threshold.toFixed(2)}: ${count(acted)}, ${outcomes.length - acted.length} asked`
    );
  }

  const wrong = outcomes.filter((outcome) => !outcome.right);
  if (wrong.length > 0) {
    console.log('\nwrong:');
    for (const outcome of wrong) {
      console.log(
        `  ${outcome.id}: expected ${outcome.expect}, got ${outcome.got} ` +
          `(${outcome.confidence.toFixed(2)})${outcome.error ? ` ${outcome.error}` : ''}`
      );
    }
  }
}

function count(outcomes: Outcome[]): string {
  return `${outcomes.filter((outcome) => outcome.right).length}/${outcomes.length}`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function pick(sorted: number[], quantile: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
