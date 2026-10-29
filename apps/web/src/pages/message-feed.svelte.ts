import { untrack } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { api, type Message } from '../api';

const PAGE_SIZE = 50;

// History and arrivals have independent cursors. Each response belongs to one conversation;
// a slow answer cannot leak into a different conversation after navigation.
export function createMessageFeed(conversationId: () => string) {
  let items = $state<Message[]>([]);
  let error = $state<string | null>(null);
  let historyError = $state<string | null>(null);
  let ready = $state(false);
  let hasOlder = $state(false);
  let loadingOlder = $state(false);
  let generation = 0;
  let active = false;
  let polling = false;
  let refreshRequested = false;

  const path = () => `/conversations/${conversationId()}/messages?limit=${PAGE_SIZE}`;
  async function reload() {
    if (!active) return;
    if (polling) {
      refreshRequested = true;
      return;
    }
    polling = true;
    const asked = generation;
    try {
      // Drain bursts in small batches, yielding back to the next poll after five pages.
      for (let page = 0; page < 5; page++) {
        const newest = items.at(-1);
        const result = await api.get<Message[]>(
          `${path()}&${newest ? `afterId=${newest.id}` : 'latest=true'}`
        );
        if (!active || asked !== generation) return;
        if (!ready) hasOlder = result.length === PAGE_SIZE;
        const ids = new SvelteSet(items.map((message) => message.id));
        const added = result.filter((message) => !ids.has(message.id));
        if (added.length) items = [...items, ...added];
        ready = true;
        error = null;
        if (!newest || result.length < PAGE_SIZE || !added.length) break;
      }
    } catch (caught) {
      if (active && asked === generation)
        error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (asked === generation) {
        polling = false;
        if (refreshRequested) {
          refreshRequested = false;
          void reload();
        }
      }
    }
  }

  async function older() {
    if (!active || !hasOlder || loadingOlder || !items.length) return;
    loadingOlder = true;
    const asked = generation;
    try {
      const result = await api.get<Message[]>(`${path()}&beforeId=${items[0].id}`);
      if (!active || asked !== generation) return;
      const ids = new SvelteSet(items.map((message) => message.id));
      items = [...result.filter((message) => !ids.has(message.id)), ...items];
      hasOlder = result.length === PAGE_SIZE;
      historyError = null;
    } catch (caught) {
      if (active && asked === generation)
        historyError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (asked === generation) loadingOlder = false;
    }
  }

  $effect(() => {
    conversationId();
    generation++;
    active = true;
    items = [];
    error = null;
    historyError = null;
    ready = false;
    hasOlder = false;
    loadingOlder = false;
    polling = false;
    refreshRequested = false;
    untrack(() => void reload());
    const timer = setInterval(() => void reload(), 2500);
    return () => {
      active = false;
      generation++;
      clearInterval(timer);
    };
  });

  return {
    get data() {
      return { data: items };
    },
    get ready() {
      return ready;
    },
    get error() {
      return error;
    },
    get historyError() {
      return historyError;
    },
    get hasOlder() {
      return hasOlder;
    },
    get loadingOlder() {
      return loadingOlder;
    },
    reload,
    older
  };
}
