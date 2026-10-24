// Old keys are read only for the one-time upgrade of existing browsers.
const previousKeys = {
  actorId: 'collaborative-agents.actorId',
  theme: 'collaborative-agents.theme'
};
type Preference = keyof typeof previousKeys;

export function readPreference(name: Preference): string | null {
  try {
    const key = `endeavor.${name}`;
    const current = localStorage.getItem(key);
    const previous = localStorage.getItem(previousKeys[name]);
    const value = current ?? previous;
    if (previous !== null) {
      try {
        if (current === null) localStorage.setItem(key, previous);
        localStorage.removeItem(previousKeys[name]);
      } catch {
        // A browser that refuses writes can still use its saved choice for this page.
      }
    }
    return value;
  } catch {
    return null;
  }
}

export function writePreference(name: Preference, value: string | null): void {
  try {
    const key = `endeavor.${name}`;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    localStorage.removeItem(previousKeys[name]);
  } catch {
    // The in-memory choice still works when browser storage is unavailable.
  }
}
