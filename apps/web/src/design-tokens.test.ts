import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the bundled tokens match the approved design export', () => {
  const bundled = readFileSync(new URL('./design-tokens.css', import.meta.url), 'utf8');
  const approved = readFileSync(
    new URL('../../../docs/design/style-guide/tokens.css', import.meta.url),
    'utf8'
  );
  assert.equal(
    bundled,
    approved,
    'Copy docs/design/style-guide/tokens.css to apps/web/src/design-tokens.css after a design export.'
  );
});
