const THEME_KEY = 'collaborative-agents.theme';
export function readTheme(): 'dark' | 'light' {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* The choice still works for this page. */
  }
}
export const conversationName = (title: string): string =>
  title.trim().replace(/^#\s*/, '').replace(/\s+/g, '-');
