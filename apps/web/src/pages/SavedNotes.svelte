<script lang="ts">
  import { type AgentNote } from '../api';
  import { CONTEXT_LABELS } from '../components';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';
  import ContextExplainer from './ContextExplainer.svelte';
  import { loadAll } from './agent-data';
  import NoteRow from './NoteRow.svelte';

  let {
    agentId
  }: {
    agentId: string;
  } = $props();
  const notes = createLoad(
    () => loadAll<AgentNote>(`/agents/${agentId}/notes`),
    () => [agentId]
  );
  const name = createNames();
</script>

<h2>Saved notes (agent memory)</h2>

<Hint>
  {CONTEXT_LABELS.notes}
</Hint>

<ContextExplainer />

<ErrorNote error={notes.error} />

{#if notes.data?.length === 0}
  <p class="muted">No saved notes.</p>
{/if}

<ul class="list">
  {#each notes.data ?? [] as note (note.id)}
    <NoteRow {agentId} {note} {name} onChanged={notes.reload} />
  {/each}
</ul>
