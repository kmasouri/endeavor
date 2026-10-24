import type { HumanPreferences } from './api';

type Theme = HumanPreferences['theme'];
const THEME_KEY = 'collaborative-agents.theme';
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
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
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* The choice still works for this page. */
  }
}

export const conversationName = (title: string): string =>
  title.trim().replace(/^#\s*/, '').replace(/\s+/g, '-');
