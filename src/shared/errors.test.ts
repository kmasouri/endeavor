import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERRORS } from './errors';

describe('error catalog', () => {
  const docs = readFileSync(join(__dirname, '../../docs/errors.md'), 'utf8');

  it.each(Object.entries(ERRORS))('documents %s in docs/errors.md', (name, definition) => {
    expect(docs).toMatch(new RegExp(`\\| ${definition.code}\\s+\\| \`${name}\``));
  });

  it('never uses the same code twice', () => {
    const codes = Object.values(ERRORS).map((definition) => definition.code);

    expect(new Set(codes).size).toBe(codes.length);
  });
});
