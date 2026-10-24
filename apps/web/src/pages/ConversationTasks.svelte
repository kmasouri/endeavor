<script lang="ts">
  import { api, type Task } from '../api';
  import { createLoad } from '../state.svelte';

  let {
    conversationId
  }: {
    conversationId: string;
  } = $props();
  const tasks = createLoad(
    () => api.list<Task>(`/tasks?conversationId=${conversationId}&limit=20`),
    () => [conversationId],
    4000
  );
  let open = $derived(
    (tasks.data?.data ?? []).filter((t) => t.state !== 'completed' && t.state !== 'cancelled')
  );
</script>

<h2>Work here</h2>

{#if (tasks.data?.data ?? []).length === 0}
  <p class="muted">No tasks yet.</p>
{/if}

<ul class="list small">
  {#each (open.length > 0 ? open : (tasks.data?.data ?? []).slice(0, 5)) ?? [] as task (task.id)}
    <li>
      <a href={`#/tasks/${task.id}`}>
        {task.title}
      </a>

      <span class={`badge state-${task.state}`}>
        {task.state}
      </span>

      {#if task.pausedAt}
        <span class="badge"> paused </span>
      {/if}
    </li>
  {/each}
</ul>

{#if open.length === 0 && (tasks.data?.data ?? []).length > 0}
  <p class="muted small">Nothing open. Showing the latest.</p>
{/if}
