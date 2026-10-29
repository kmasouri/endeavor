/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileModule } from 'svelte/compiler';
import { flushSync } from 'svelte';
import ts from 'typescript';

// Compile the runes as Vite does, then use Svelte's browser runtime without mounting a DOM.
// Resolving imports first lets the compiled module run from an in-memory URL.
const source = readFileSync(new URL('./state.svelte.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
}).outputText;
const harness = `
export function root(fn) { return $effect.root(fn); }
export function cell(initial) {
  let value = $state(initial);
  return { get value() { return value; }, set value(next) { value = next; } };
}`;
const compiled = compileModule(javascript + harness, {
  filename: 'state.svelte.js',
  generate: 'client'
}).js.code.replace(
  /from (['"])(svelte[^'"]*)\1/g,
  (_, _quote, name: string) => `from ${JSON.stringify(import.meta.resolve(name))}`
);
const { createLoad, createAction, root, cell } = (await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)) as typeof import('./state.svelte') & {
  root: (fn: () => void) => () => void;
  cell: <T>(initial: T) => { value: T };
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('a slow previous page and its errors cannot overwrite the current page', async () => {
  const page = cell('first');
  const first = deferred<string>();
  const second = deferred<string>();
  let resource!: ReturnType<typeof createLoad<string>>;
  const destroy = root(() => {
    resource = createLoad(
      () => (page.value === 'first' ? first.promise : second.promise),
      () => [page.value]
    );
  });
  try {
    flushSync();
    await settle();
    page.value = 'second';
    flushSync();
    await settle();
    second.resolve('second page');
    await settle();
    first.reject(new Error('old page failed'));
    await settle();
    assert.equal(resource.data, 'second page');
    assert.equal(resource.error, null);
  } finally {
    destroy();
  }
});

test('the newest reload wins even when an older request finishes later', async () => {
  const requests = [deferred<string>(), deferred<string>()];
  let calls = 0;
  let resource!: ReturnType<typeof createLoad<string>>;
  const destroy = root(() => {
    resource = createLoad(
      () => requests[calls++].promise,
      () => []
    );
  });
  try {
    flushSync();
    await settle();
    const reloaded = resource.reload();
    await settle();
    requests[1].resolve('newest');
    assert.equal(await reloaded, true);
    await settle();
    requests[0].resolve('older');
    await settle();
    assert.equal(resource.data, 'newest');
  } finally {
    destroy();
  }
});

test('unmounting stops polling and discards pending answers', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const pending = deferred<string>();
  let calls = 0;
  let resource!: ReturnType<typeof createLoad<string>>;
  const destroy = root(() => {
    resource = createLoad(
      () => {
        calls += 1;
        return pending.promise;
      },
      () => [],
      100
    );
  });
  flushSync();
  await settle();
  t.mock.timers.tick(100);
  await settle();
  assert.equal(calls, 1);
  destroy();
  t.mock.timers.tick(500);
  pending.resolve('closed page');
  await settle();
  assert.equal(calls, 1);
  assert.equal(resource.data, undefined);
});

test('polling lets a slow request finish before starting another', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const answer = deferred<string>();
  let calls = 0;
  let resource!: ReturnType<typeof createLoad<string>>;
  const destroy = root(() => {
    resource = createLoad(
      () => {
        calls += 1;
        return answer.promise;
      },
      () => [],
      100
    );
  });
  try {
    flushSync();
    await settle();
    t.mock.timers.tick(500);
    await settle();
    assert.equal(calls, 1);
    answer.resolve('slow answer');
    await settle();
    assert.equal(resource.data, 'slow answer');
    t.mock.timers.tick(100);
    await settle();
    assert.equal(calls, 2);
  } finally {
    destroy();
  }
});

test('actions show failures, clear them on retry, and prevent duplicate submissions', async () => {
  const action = createAction();
  const pending = deferred<void>();
  const first = action.run(() => pending.promise);
  assert.equal(action.busy, true);
  assert.equal(await action.run(async () => assert.fail('duplicate submission')), false);
  pending.reject(new Error('Save failed'));
  assert.equal(await first, false);
  assert.equal(action.busy, false);
  assert.equal(action.error, 'Save failed');
  assert.equal(await action.run(async () => {}), true);
  assert.equal(action.error, null);
});

test('reload reports failures and closed resources without rejecting', async () => {
  let resource!: ReturnType<typeof createLoad<string>>;
  const destroy = root(() => {
    resource = createLoad(
      async () => {
        throw new Error('load failed');
      },
      () => []
    );
  });
  flushSync();
  await settle();
  assert.equal(await resource.reload(), false);
  assert.equal(resource.error, 'load failed');
  destroy();
  assert.equal(await resource.reload(), false);
});
