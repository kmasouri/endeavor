<script lang="ts">
  import type { Conversation } from '../api';
  import Modal from '../Modal.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import { conversationName } from '../appearance';
  let { conversations, error, loading, onPick, onClose, onRetry }: {
    conversations: Conversation[];
    error: string | null;
    loading: boolean;
    onPick: (id: string) => void;
    onClose: () => void;
    onRetry: () => void;
  } = $props();
  let query = $state('');
  let results = $derived(conversations.filter((conversation) => conversationName(conversation.title).toLowerCase().includes(query.trim().toLowerCase())));
</script>

<Modal title="Find an endeavor" wide dismissOnBackdrop {onClose}>
  <form class="stack endeavor-form" onsubmit={(event) => { event.preventDefault(); if (results[0]) onPick(results[0].id); }}>
    <label>Search endeavors<input type="search" bind:value={query} placeholder="Search by name…" /></label>
    <ErrorNote {error} />
    {#if error}<button type="button" class="secondary" onclick={onRetry}>Retry search</button>{/if}
    <div class="endeavor-results" aria-label="Endeavors">
      {#each results as conversation (conversation.id)}
        <button type="button" class="quiet" title={conversationName(conversation.title)} onclick={() => onPick(conversation.id)}><span>{conversationName(conversation.title)}</span></button>
      {/each}
      {#if !results.length}<p class="muted">{loading ? 'Loading endeavors…' : 'No endeavors found.'}</p>{/if}
    </div>
  </form>
</Modal>
