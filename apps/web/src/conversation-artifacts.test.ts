import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Message, Task } from './api';
import { conversationArtifacts, type ConversationOutput } from './conversation-artifacts.ts';

const output: ConversationOutput = {
  id: 'o1',
  taskId: 't1',
  kind: 'text',
  title: 'Result',
  content: 'Hey Kayvan! What can I help you with?',
  uri: null,
  createdAt: '2026-10-24T18:00:00Z'
};
const message: Message = {
  id: 'm1',
  authorType: 'agent',
  authorId: 'a1',
  body: output.content!,
  taskId: 't1',
  mentions: [],
  inReplyToMessageId: null,
  createdAt: output.createdAt
};

test('a generated answer already posted by its agent is shown only as a message', () => {
  assert.deepEqual(conversationArtifacts([output], [message], []), []);
  assert.deepEqual(
    conversationArtifacts([{ ...output, content: '\n' + output.content + '\r\n' }], [message], []),
    []
  );
});

test('distinct deliverables, links, and answers not posted to chat keep their cards', () => {
  for (const item of [
    { ...output, title: 'Research brief' },
    { ...output, kind: 'file' },
    { ...output, uri: 'https://example.com/brief' },
    { ...output, content: 'A different result' }
  ])
    assert.deepEqual(conversationArtifacts([item], [message], []), [item]);
  assert.deepEqual(conversationArtifacts([output], [], []), [output]);
});

test('text from another task or a human does not hide an agent output', () => {
  assert.deepEqual(conversationArtifacts([output], [{ ...message, taskId: 't2' }], []), [output]);
  assert.deepEqual(conversationArtifacts([output], [{ ...message, authorType: 'human' }], []), [
    output
  ]);
});

test('pending review stays visible even if a matching message exists', () => {
  const task = {
    id: 't1',
    reviewRequired: true,
    state: 'waiting',
    criteriaCheck: { met: true, summary: 'Ready' },
    review: null
  } as Task;
  assert.deepEqual(conversationArtifacts([output], [message], [task]), [output]);
});
