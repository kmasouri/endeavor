// Starts one pilot 1 brief: a new conversation for the topic, its documents, and the request.
//
//   npm run pilot:brief -- --topic 1          the team: Researcher and Reviewer
//   npm run pilot:brief -- --topic 1 --solo   the baseline: Solo Researcher alone
//
// Topics come from pilot/topics.json (copy pilot/topics.example.json). See docs/pilot.md.

import { readFileSync } from 'node:fs';
import { Api, loadState, parseArgs, saveState } from './client.ts';

// Each brief's conversation gets this budget, twice the CA-3 target of $0.50 per brief, so an
// overrun shows up in the report instead of cutting the brief off.
const BRIEF_BUDGET_USD = 1;

interface Topic {
  topic: string;
  audience?: string;
  documents?: { title: string; file: string }[];
}

const args = parseArgs(process.argv.slice(2));
const topicNumber = Number(args.topic);
const solo = args.solo === true;
const topicsPath = typeof args.topics === 'string' ? args.topics : 'pilot/topics.json';

async function main(): Promise<void> {
  const state = loadState();
  const topics = (JSON.parse(readFileSync(topicsPath, 'utf8')) as { topics: Topic[] }).topics;
  const topic = topics[topicNumber - 1];
  if (!Number.isInteger(topicNumber) || !topic) {
    throw new Error(`--topic must be 1 to ${topics.length}`);
  }
  if (/^Replace with/.test(topic.topic)) {
    throw new Error(
      `Topic ${topicNumber} in ${topicsPath} is still the example. Fill it in first.`
    );
  }

  const mode = solo ? 'solo' : 'team';
  const already = state.briefs.find(
    (brief) => brief.topicNumber === topicNumber && brief.mode === mode
  );
  if (already && args.again !== true) {
    throw new Error(
      `Topic ${topicNumber} (${mode}) already ran in conversation ${already.conversationId}. Add --again to run it once more.`
    );
  }

  const api = new Api(state.apiUrl, state.actorId);
  const agentIds = solo ? [state.agents.solo] : [state.agents.researcher, state.agents.reviewer];
  const conversation = await api.post<{ id: string }>('/conversations', {
    title: `Brief ${topicNumber} (${mode}): ${topic.topic}`.slice(0, 200),
    agentIds
  });
  await api.patch(`/conversations/${conversation.id}`, { budgetUsd: BRIEF_BUDGET_USD });
  for (const document of topic.documents ?? []) {
    await api.post(`/conversations/${conversation.id}/documents`, {
      title: document.title,
      content: readFileSync(document.file, 'utf8')
    });
  }

  const writer = solo ? 'Solo Researcher' : 'Researcher';
  const message = await api.post<{ id: string }>(`/conversations/${conversation.id}/messages`, {
    body: `@${writer} Please write a one-page brief on: ${topic.topic}. It's for ${topic.audience ?? 'a curious non-expert'}. Every claim needs a source.`,
    mentions: [{ type: 'agent', id: solo ? state.agents.solo : state.agents.researcher }]
  });

  state.briefs.push({
    topicNumber,
    mode,
    conversationId: conversation.id,
    messageId: message.id,
    startedAt: new Date().toISOString()
  });
  saveState(state);
  console.log(`Started brief ${topicNumber} (${mode}). Watch it at ${state.apiUrl}`);
  console.log(`Conversation: ${conversation.id}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
