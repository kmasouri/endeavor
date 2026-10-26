/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';
import type { Human } from './api.ts';

async function loadRunes(file: string) {
  const javascript = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
  }).outputText;
  const code = compileModule(javascript, {
    filename: file.replace('.ts', '.js'),
    generate: 'client'
  }).js.code.replace(
    /from (['"])(svelte[^'"]*)\1/g,
    (_, _quote, name: string) => `from ${JSON.stringify(import.meta.resolve(name))}`
  );
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { createProfileEditor } = (await loadRunes(
  './profile-state.svelte.ts'
)) as typeof import('./profile-state.svelte');
const { timeDisplay, formatShortTime, formatDateTime } = (await loadRunes(
  './time-display.svelte.ts'
)) as typeof import('./time-display.svelte');
const person: Human = {
  id: 'person-1',
  name: 'Kayvan',
  role: 'member',
  preferences: { theme: 'system', timeFormat: '12h' }
};

function setup() {
  let stored = structuredClone(person);
  const writes: unknown[] = [];
  const saved: Human[] = [];
  const editor = createProfileEditor(
    stored,
    async (input) => {
      writes.push(input);
      stored = { ...stored, ...input };
      return stored;
    },
    (person) => saved.push(person)
  );
  return { editor, writes, saved };
}

test('profile and preferences keep independent drafts and save only their own fields', async () => {
  const { editor, writes, saved } = setup();
  editor.name = '  New name  ';
  editor.theme = 'light';
  editor.timeFormat = '24h';
  await editor.save('profile');
  assert.deepEqual(writes, [{ name: 'New name' }]);
  assert.equal(editor.name, 'New name');
  assert.equal(editor.profileDirty, false);
  assert.equal(editor.preferencesDirty, true);
  assert.equal(editor.theme, 'light');
  assert.equal(saved[0].id, person.id);
  await editor.save('preferences');
  assert.deepEqual(writes[1], { preferences: { theme: 'light', timeFormat: '24h' } });
  assert.equal(editor.dirty, false);
  assert.equal(editor.success, 'Preferences saved.');
});

test('unchanged and invalid names never send a save, and discard affects only its tab', async () => {
  const { editor, writes } = setup();
  await editor.save('profile');
  await editor.save('preferences');
  editor.name = '  ';
  assert.match(editor.nameError, /Enter/);
  await editor.save('profile');
  editor.name = 'x'.repeat(101);
  assert.match(editor.nameError, /100/);
  await editor.save('profile');
  assert.equal(writes.length, 0);
  editor.theme = 'dark';
  editor.discard('profile');
  assert.equal(editor.name, 'Kayvan');
  assert.equal(editor.theme, 'dark');
  editor.discard('preferences');
  assert.equal(editor.theme, 'system');
  assert.equal(editor.dirty, false);
});

test('failed saves keep edits, expose retry, block duplicate submits and navigation while saving', async () => {
  let reject!: (error: Error) => void;
  let attempts = 0;
  const editor = createProfileEditor(
    person,
    async (input) => {
      attempts++;
      if (attempts === 1)
        return new Promise((_resolve, no) => {
          reject = no;
        });
      return { ...person, ...input };
    },
    () => {}
  );
  editor.name = 'Updated';
  const save = editor.save('profile');
  assert.equal(editor.busy, true);
  assert.equal(
    editor.canLeave(() => true),
    false
  );
  await editor.save('profile');
  assert.equal(attempts, 1);
  reject(new Error('Offline'));
  await save;
  assert.equal(editor.busy, false);
  assert.equal(editor.name, 'Updated');
  assert.equal(editor.dirty, true);
  assert.equal(editor.error, 'Offline');
  assert.equal(
    editor.canLeave(() => false),
    false
  );
  assert.equal(
    editor.canLeave(() => true),
    true
  );
  await editor.save('profile');
  assert.equal(editor.error, '');
  assert.equal(editor.dirty, false);
  assert.equal(
    editor.canLeave(() => assert.fail('No prompt for saved edits')),
    true
  );
});

test('a new person gets their own saved preferences and drafts', () => {
  const { editor } = setup();
  editor.theme = 'light';
  const next = createProfileEditor(
    { ...person, id: 'person-2', name: 'Sam', preferences: { theme: 'dark', timeFormat: '24h' } },
    async () => person,
    () => {}
  );
  assert.equal(next.name, 'Sam');
  assert.equal(next.theme, 'dark');
  assert.equal(next.timeFormat, '24h');
  assert.equal(next.dirty, false);
});

test('message and run times honor the person format without mutating the original instant', () => {
  const instant = '2026-10-24T21:31:00Z';
  timeDisplay.format = '12h';
  const before = formatShortTime(instant);
  assert.equal(
    before,
    new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h12'
    }).format(Date.parse(instant))
  );
  timeDisplay.format = '24h';
  assert.equal(
    formatShortTime(instant),
    new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(Date.parse(instant))
  );
  assert.notEqual(formatShortTime(instant), before);
  assert.equal(
    formatDateTime(instant),
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23'
    }).format(Date.parse(instant))
  );
  assert.equal(instant, '2026-10-24T21:31:00Z');
});
