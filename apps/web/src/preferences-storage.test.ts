import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPreference, writePreference } from './preferences-storage.ts';

function storage(values: Record<string, string>, failWrites = false) {
  const entries = new Map(Object.entries(values));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error('Storage unavailable');
        entries.set(key, value);
      },
      removeItem: (key: string) => entries.delete(key)
    }
  });
  return {
    entries,
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  };
}

test('upgrades existing person and theme without losing the selection', () => {
  const saved = storage({
    'collaborative-agents.actorId': 'person-1',
    'collaborative-agents.theme': 'dark'
  });
  try {
    assert.equal(readPreference('actorId'), 'person-1');
    assert.equal(readPreference('theme'), 'dark');
    assert.deepEqual(Object.fromEntries(saved.entries), {
      'endeavor.actorId': 'person-1',
      'endeavor.theme': 'dark'
    });
    assert.equal(readPreference('actorId'), 'person-1');
  } finally {
    saved.restore();
  }
});

test('keeps a newer choice and cannot revive an old person after clearing it', () => {
  const saved = storage({
    'endeavor.actorId': 'person-2',
    'collaborative-agents.actorId': 'person-1'
  });
  try {
    assert.equal(readPreference('actorId'), 'person-2');
    writePreference('actorId', null);
    assert.equal(readPreference('actorId'), null);
    assert.equal(saved.entries.size, 0);
  } finally {
    saved.restore();
  }
});

test('keeps the previous value if storage refuses the migration write', () => {
  const saved = storage({ 'collaborative-agents.theme': 'light' }, true);
  try {
    assert.equal(readPreference('theme'), 'light');
    assert.equal(saved.entries.get('collaborative-agents.theme'), 'light');
  } finally {
    saved.restore();
  }
});
