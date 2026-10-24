<script lang="ts">
  import { api, type ConversationDocument } from '../api';
  import { CONTEXT_LABELS } from '../components';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction, createLoad } from '../state.svelte';

  let {
    conversationId
  }: {
    conversationId: string;
  } = $props();
  const docs = createLoad(
    () => api.get<ConversationDocument[]>(`/conversations/${conversationId}/documents`),
    () => [conversationId]
  );
  let title = $state('');
  let content = $state('');
  const action = createAction();
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post(`/conversations/${conversationId}/documents`, { title, content }))
      .then((ok) => ok && ((title = ''), (content = ''), docs.reload()));
  };
</script>

<h2>Knowledge sources</h2>

<Hint>
  {CONTEXT_LABELS.knowledge} Agents here can use these.
</Hint>

<ErrorNote error={docs.error} />

<ul class="list">
  {#if (docs.data ?? []).length === 0}
    <li class="muted">None attached.</li>
  {/if}

  {#each docs.data ?? [] as doc (doc.id)}
    <li class="row">
      <details class="grow">
        <summary>
          {doc.title}
        </summary>

        <pre>{doc.content}</pre>
      </details>

      <button
        class="secondary"
        disabled={action.busy}
        onclick={() =>
          void action
            .run(() => api.delete(`/conversations/${conversationId}/documents/${doc.id}`))
            .then(docs.reload)}
      >
        Remove
      </button>
    </li>
  {/each}
</ul>

<details>
  <summary> Attach a document </summary>

  <form onsubmit={add} class="stack">
    <input bind:value={title} placeholder="Title" required />

    <textarea bind:value={content} rows={5} placeholder="Paste the text" required></textarea>

    <button disabled={action.busy}> Attach </button>
  </form>
</details>

<ErrorNote error={action.error} />
