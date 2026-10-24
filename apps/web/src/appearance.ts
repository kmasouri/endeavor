import type { HumanPreferences } from './api';
import { readPreference, writePreference } from './preferences-storage';

type Theme = HumanPreferences['theme'];
export function readTheme(): Theme {
  try {
    const stored = readPreference('theme');
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  try {
    writePreference('theme', theme);
  } catch {
    /* The choice still works for this page. */
  }
}

export const conversationName = (title: string): string =>
  title.trim().replace(/^#\s*/, '').replace(/\s+/g, ' ');
