import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampSidebarWidth, readSidebarWidth, sidebarWidth, writeSidebarWidth } from './sidebar-width.ts';

function storage(values: Record<string, string>, fail = false) {
  const entries = new Map(Object.entries(values));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => {
        if (fail) throw new Error('Storage unavailable');
        return entries.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (fail) throw new Error('Storage unavailable');
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

test('keeps the width between the minimum and maximum', () => {
  assert.equal(clampSidebarWidth(100), sidebarWidth.min);
  assert.equal(clampSidebarWidth(900), sidebarWidth.max);
  assert.equal(clampSidebarWidth(300.4), 300);
  assert.equal(clampSidebarWidth(Number.NaN), sidebarWidth.initial);
});

test('remembers a chosen width and forgets the default', () => {
  const saved = storage({});
  try {
    assert.equal(readSidebarWidth(), sidebarWidth.initial);
    writeSidebarWidth(360);
    assert.equal(readSidebarWidth(), 360);
    writeSidebarWidth(sidebarWidth.initial);
    assert.deepEqual(Object.fromEntries(saved.entries), {});
  } finally {
    saved.restore();
  }
});

test('clamps a saved width that is out of range or not a number', () => {
  const saved = storage({ 'endeavor.sidebarWidth': '2000' });
  try {
    assert.equal(readSidebarWidth(), sidebarWidth.max);
    saved.entries.set('endeavor.sidebarWidth', 'wide');
    assert.equal(readSidebarWidth(), sidebarWidth.initial);
  } finally {
    saved.restore();
  }
});

test('falls back to the default when storage is unavailable', () => {
  const saved = storage({}, true);
  try {
    assert.equal(readSidebarWidth(), sidebarWidth.initial);
    assert.doesNotThrow(() => writeSidebarWidth(300));
  } finally {
    saved.restore();
  }
});
