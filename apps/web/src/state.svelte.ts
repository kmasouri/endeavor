import { untrack } from 'svelte';

// Hash routes stay entirely in the browser, separate from the HTTP API.
export function go(path: string): void {
  window.location.hash = path;
}

// Each resource belongs to the component that creates it. Dependency changes and unmounting
// invalidate pending requests; only the newest request can publish a result.
export function createLoad<T>(
  load: () => Promise<T>,
  dependencies: () => unknown[],
  everyMs?: number
) {
  let data = $state<T>();
  let error = $state<string | null>(null);
  let generation = 0;
  let request = 0;
  let active = false;
  let pending = false;

  function reload(): Promise<boolean> {
    if (!active) return Promise.resolve(false);
    pending = true;
    const askedGeneration = generation;
    const askedRequest = ++request;
    return Promise.resolve()
      .then(load)
      .then(
        (value) => {
          if (active && askedGeneration === generation && askedRequest === request) {
            data = value;
            error = null;
            return true;
          }
          return false;
        },
        (caught: unknown) => {
          if (active && askedGeneration === generation && askedRequest === request) {
            error = caught instanceof Error ? caught.message : String(caught);
          }
          return false;
        }
      )
      .finally(() => {
        if (askedRequest === request) pending = false;
      });
  }

  $effect(() => {
    dependencies();
    generation += 1;
    active = true;
    data = undefined;
    error = null;
    untrack(reload);
    // A slow connection must still publish answers. Starting a new poll before the previous
    // one finishes would keep discarding every answer as older than the latest request.
    const timer = everyMs
      ? setInterval(() => {
          if (!pending) reload();
        }, everyMs)
      : undefined;
    return () => {
      active = false;
      generation += 1;
      clearInterval(timer);
    };
  });

  return {
    get data() {
      return data;
    },
    get error() {
      return error;
    },
    reload
  };
}

// Shared button/form feedback. Callbacks run directly, with no lifecycle side effects.
export function createAction() {
  let busy = $state(false);
  let error = $state<string | null>(null);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    busy = true;
    error = null;
    try {
      await action();
      return true;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      return false;
    } finally {
      busy = false;
    }
  }
  return {
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    run
  };
}
