import { useCallback, useEffect, useRef, useState } from 'react';

// The page is chosen by the part of the address after #, like #/conversations/<id>. Hash links
// never reach the server, so they can't clash with API paths.
export function useRoute(): string[] {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export function go(path: string): void {
  window.location.hash = path;
}

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  reload: () => void;
}

// Loads data when the page opens and whenever `deps` change. With `everyMs`, it also reloads on
// a timer, so new messages and task changes show up without refreshing.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], everyMs?: number): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  // Bumped whenever `deps` change. A slow answer for the previous page (say, another
  // conversation) is dropped instead of replacing the current one.
  const generation = useRef(0);

  const reload = useCallback(() => {
    const asked = generation.current;
    loadRef
      .current()
      .then((value) => {
        if (asked === generation.current) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught: Error) => {
        if (asked === generation.current) {
          setError(caught.message);
        }
      });
  }, []);

  useEffect(() => {
    generation.current += 1;
    setData(undefined);
    reload();
    if (!everyMs) {
      return;
    }
    const timer = setInterval(reload, everyMs);
    return () => clearInterval(timer);
  }, deps);

  return { data, error, reload };
}

// Runs an action from a button or form, tracking whether it's busy and any error to show.
export function useAction(): {
  busy: boolean;
  error: string | null;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError((caught as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run };
}
