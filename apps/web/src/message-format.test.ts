import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMessage, safeLink, messagePreview } from './message-format.ts';
test('message formatting retains HTML as inert text and rejects script links', () => {
  const blocks = formatMessage(
    '<img src=x onerror=alert(1)> [click](javascript:evil) **<script>** `</code><script>`'
  );
  assert.ok(blocks[0].items[0].every((t) => t.kind !== 'link'));
  assert.equal(blocks[0].items[0][0].text, '<img src=x onerror=alert(1)> ');
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('data:text/html,hello'), null);
  assert.equal(safeLink('https://example.com'), 'https://example.com/');
});
test('mentions use full names, including names with spaces', () => {
  const tokens = formatMessage('@Sam, @Sammy and @Research Agent.', [
    { name: 'Sam', you: true },
    { name: 'Research Agent' }
  ])[0].items[0];
  assert.deepEqual(
    tokens.filter((t) => ['you', 'mention'].includes(t.kind)),
    [
      { kind: 'you', text: '@Sam' },
      { kind: 'mention', text: '@Research Agent' }
    ]
  );
});
test('lists, code blocks and links have separate structures', () => {
  const blocks = formatMessage(
    '1. **First**\n2. Second\n\n```ts\n<a>\n```\n[Source](https://example.com)'
  );
  assert.equal(blocks[0].kind, 'list');
  assert.equal(blocks[0].items.length, 2);
  assert.deepEqual(blocks[0].items[0], [{ kind: 'strong', text: 'First' }]);
  assert.equal(blocks[2].kind, 'code');
  assert.equal(blocks[2].items[0][0].text, '<a>');
  assert.equal(blocks[3].items[0][0].href, 'https://example.com/');
});

test('reply previews flatten formatting and line breaks into readable context', () => {
  assert.equal(
    messagePreview(
      'Saved **Why bees matter**\n\n1. *Food* and [sources](https://example.com)\n```\nresults\n```'
    ),
    'Saved Why bees matter Food and sources results'
  );
});
