<script lang="ts">
  import { api, type Task } from '../api';
  import Avatar from '../Avatar.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import StateBadge from '../StateBadge.svelte';
  import { formatDateTime } from '../components';
  import { conversationName } from '../appearance';
  import { createLoad } from '../state.svelte';
  let {
    conversationId,
    conversationTitle,
    agentId,
    agentName,
    costs,
    onSelect
  }: {
    conversationId: string;
    conversationTitle: string;
    agentId: string;
    agentName: string;
    costs: { taskId: string; costUsd: number }[];
    onSelect: (taskId: string) => void;
  } = $props();
  let offset = $state(0);
  const limit = 20;
  const history = createLoad(
    () =>
      api.list<Task>(
        `/tasks?conversationId=${conversationId}&ownerAgentId=${agentId}&limit=${limit}&offset=${offset}`
      ),
    () => [conversationId, agentId, offset]
  );
</script>

<div class="history-scope">
  <div class="row"><Avatar name={agentName} id={agentId} agent /><strong>{agentName}</strong><span class="agent-label">agent</span></div>
  <p class="caption muted">Only {agentName}'s runs in {conversationName(conversationTitle)}, newest first.</p>
</div>
{#if history.error}
  <ErrorNote error={history.error} /><button class="secondary" onclick={history.reload}>Try again</button>
{:else if !history.data}<p role="status">Loading history…</p>
{:else}
  {#if !history.data.data.length}<p class="muted">No runs in this conversation yet.</p>{/if}
  <ol class="agent-history">
    {#each history.data.data as task (task.id)}
      {@const cost = costs.find((entry) => entry.taskId === task.id)}
      <li><button class="quiet history-run" onclick={() => onSelect(task.id)}>
        <strong>{task.title}</strong>
        <span class="row wrap"><StateBadge state={task.state} paused={Boolean(task.pausedAt)} />
          <time class="caption muted">{formatDateTime(task.createdAt)}</time>
          {#if cost}<span class="caption muted">${cost.costUsd.toFixed(2)}</span>{/if}
        </span>
        {#if task.stateReason}<span class="caption muted">{task.stateReason}</span>{/if}
      </button></li>
    {/each}
  </ol>
  <div class="row wrap history-pagination">
    <button class="secondary" disabled={offset === 0} onclick={() => (offset = Math.max(0, offset - limit))}>Newer runs</button>
    <button class="secondary" disabled={offset + history.data.data.length >= history.data.page.total} onclick={() => (offset += limit)}>Older runs</button>
    <span class="caption muted">{history.data.page.total} runs</span>
  </div>
{/if}
