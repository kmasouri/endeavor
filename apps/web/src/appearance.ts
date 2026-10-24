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

// Channel formatting is only a navigation label; keep the stored outcome title intact.
export const conversationChannelName = (title: string): string => {
  const name = conversationName(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `#${name || 'endeavor'}`;
};
