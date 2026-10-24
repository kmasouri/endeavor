<script lang="ts">
  import { api, type TaskOutput } from '../api';
  import Hint from '../Hint.svelte';
  import { createLoad } from '../state.svelte';

  let {
    conversationId
  }: {
    conversationId: string;
  } = $props();
  const outputs = createLoad(
    () =>
      api.list<
        TaskOutput & {
          taskId: string;
        }
      >(`/conversations/${conversationId}/outputs?limit=20`),
    () => [conversationId],
    5000
  );
  let list = $derived(outputs.data?.data ?? []);
</script>

<h2>Outputs</h2>

<Hint>Results and evidence agents attached here. Ask in the thread to question or revise one.</Hint>

{#if list.length === 0}
  <p class="muted">None yet.</p>
{/if}

<ul class="list small">
  {#each list ?? [] as output (output.id)}
    <li>
      <details>
        <summary>
          {output.title}

          <span class="badge">
            {output.kind}
          </span>
        </summary>

        {#if output.uri}
          <div class="muted">
            {output.uri}
          </div>
        {/if}

        {#if output.content}
          <pre>
{output.content}
</pre>
        {/if}

        <a href={`#/tasks/${output.taskId}`}> Open the task </a>
      </details>
    </li>
  {/each}
</ul>
