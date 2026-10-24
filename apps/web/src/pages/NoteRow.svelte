<script lang="ts">
  import { untrack } from 'svelte';
  import { type AgentNote, api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { when } from '../components';
  import { createAction } from '../state.svelte';

  let props: {
    agentId: string;
    note: AgentNote;
    name: (actor: { type: string; id: string | null }) => string;
    onChanged: () => void;
  } = $props();
  let n = $derived(props.note);
  let editing = $state(false);
  let body = $state(untrack(() => n.body));
  const action = createAction();
  let path = $derived(`/agents/${props.agentId}/notes/${n.id}`);
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
      <textarea bind:value={body} rows={3}></textarea>

      <div class="row">
        <button disabled={action.busy}> Save </button>

        <button type="button" class="secondary" onclick={() => (editing = false)}> Cancel </button>
      </div>
    </form>
  {:else}
    <p class="body">
      {n.body}
    </p>
  {/if}

  <div class="muted small">
    Written by {props.name(n.createdBy)}
    {when(n.createdAt)}

    {#if n.sourceConversationId}
      in

      <a href={`#/conversations/${n.sourceConversationId}`}> a conversation </a>
    {/if}

    {#if n.sourceTaskId}
      during

      <a href={`#/tasks/${n.sourceTaskId}`}> a task </a>
    {/if}

    {#if n.updatedByHumanId}
      {` · corrected by ${props.name({ type: 'human', id: n.updatedByHumanId })}`}
    {/if}

    ·

    {#if n.scope === 'agent'}
      used in all its work
    {:else}
      used only in that conversation
    {/if}
  </div>

  {#if !editing}
    <div class="row wrap">
      <button class="secondary" onclick={() => (editing = true)}> Correct </button>

      <button
        class="secondary"
        disabled={action.busy}
        onclick={() =>
          void action
            .run(() => api.patch(path, { scope: n.scope === 'agent' ? 'conversation' : 'agent' }))
            .then(props.onChanged)}
      >
        {#if n.scope === 'agent'}
          Use only in its conversation
        {:else}
          Use in all its work
        {/if}
      </button>

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
