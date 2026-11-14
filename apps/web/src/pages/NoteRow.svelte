<script lang="ts">
  import { type AgentNote, api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { formatDateTime } from '../components';
  import { createAction } from '../state.svelte';

  let props: {
    agentId: string;
    note: AgentNote;
    name: (actor: { type: string; id: string | null }) => string;
    onChanged: () => void;
  } = $props();
  let note = $derived(props.note);
  let editing = $state(false);
  let body = $state('');
  const action = createAction();
  let path = $derived(`/agents/${props.agentId}/notes/${note.id}`);
  // Narrowing an agent-wide note keeps it to its project, or to its conversation for older notes.
  let narrowScope = $derived(note.projectId ? 'project' : note.sourceConversationId ? 'conversation' : null);
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.patch(path, { body }))
      .then((ok) => ok && ((editing = false), props.onChanged()));
  };
</script>

<li>
  {#if editing}
    <form onsubmit={save} class="stack">
      <textarea aria-label="Note text" bind:value={body} rows={3} maxlength={10000} required disabled={action.busy}></textarea>

      <div class="row">
        <button disabled={action.busy || !body.trim()}> Save </button>

        <button type="button" class="secondary" disabled={action.busy} onclick={() => (editing = false)}> Cancel </button>
      </div>
    </form>
  {:else}
    <p class="body">
      {note.body}
    </p>
  {/if}

  <div class="muted small">
    Written by {props.name(note.createdBy)}
    {formatDateTime(note.createdAt)}

    {#if note.sourceConversationId}
      in

      <a href={`#/conversations/${note.sourceConversationId}`}> a conversation </a>
    {/if}

    {#if note.sourceTaskId}
      during

      <a href={`#/tasks/${note.sourceTaskId}`}> a task </a>
    {/if}

    {#if note.updatedByHumanId}
      {` · corrected by ${props.name({ type: 'human', id: note.updatedByHumanId })}`}
    {/if}

    ·

    {#if note.scope === 'agent'}
      used in all its work
    {:else if note.scope === 'project'}
      used in every endeavor of that project
    {:else}
      used only in that conversation
    {/if}
  </div>

  {#if !editing}
    <div class="row wrap">
      <button class="secondary" disabled={action.busy} onclick={() => { body = note.body; editing = true; }}> Correct </button>

      {#if note.scope !== 'agent' || narrowScope}
      <button
        class="secondary"
        disabled={action.busy}
        onclick={() =>
          void action
            .run(() => api.patch(path, { scope: note.scope === 'agent' ? narrowScope : 'agent' }))
            .then(props.onChanged)}
      >
        {#if note.scope === 'agent' && narrowScope === 'project'}
          Use only in its project
        {:else if note.scope === 'agent'}
          Use only in its conversation
        {:else}
          Use in all its work
        {/if}
      </button>
      {/if}

      <button
        class="secondary"
        disabled={action.busy}
        onclick={() =>
          confirm('Delete this note?') &&
          void action.run(() => api.delete(path)).then(props.onChanged)}
      >
        Delete
      </button>
    </div>
  {/if}

  <ErrorNote error={action.error} />
</li>

<style>
  .body { white-space: pre-wrap; }
</style>
