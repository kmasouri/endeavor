<script lang="ts">
  import { api, type ConversationDocument } from '../api';
  import { CONTEXT_LABELS } from '../components';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction, createLoad } from '../state.svelte';

  let {
    conversationId, projectId
  }: {
    conversationId?: string;
    projectId?: string;
  } = $props();
  const path = $derived(projectId ? `/projects/${projectId}/documents` : `/conversations/${conversationId}/documents`);
  const docs = createLoad(
    () => api.get<ConversationDocument[]>(path),
    () => [conversationId, projectId]
  );
  let title = $state('');
  let content = $state('');
  const action = createAction();
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post(path, { title, content }))
      .then((ok) => ok && ((title = ''), (content = ''), docs.reload()));
  };
</script>

<h2>Knowledge sources</h2>

<Hint>
  {CONTEXT_LABELS.knowledge} {projectId ? "Every endeavor in this project can use these." : "Agents here can use these."}
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
            .run(() => api.delete(`${path}/${doc.id}`))
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
    <input aria-label="Document title" maxlength="200" bind:value={title} placeholder="Title" required />

    <textarea aria-label="Document text" maxlength="100000" bind:value={content} rows={5} placeholder="Paste the text" required></textarea>

    <button disabled={action.busy}> Attach </button>
  </form>
</details>

<ErrorNote error={action.error} />
