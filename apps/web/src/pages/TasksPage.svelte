<script lang="ts">
  import Avatar from '../Avatar.svelte';
  import PageHeader from '../PageHeader.svelte';
  import { api, type Task, TASK_STATES, type TaskState } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import StateBadge from '../StateBadge.svelte';
  import { formatDateTime } from '../components';
  import { createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';

  const filters = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const conversationFilter = filters.get('conversationId');
  const agentFilter = filters.get('agentId');
  let state = $state<TaskState | ''>('');
  const tasks = createLoad(
    () =>
      api.list<Task>(
        `/tasks?limit=100${state ? `&state=${state}` : ''}${conversationFilter ? `&conversationId=${encodeURIComponent(conversationFilter)}` : ''}${agentFilter ? `&ownerAgentId=${encodeURIComponent(agentFilter)}` : ''}`
      ),
    () => [state],
    5000
  );
  const name = createNames();
</script>

<PageHeader title="Work" subtitle="Inspect agent work, results, and execution history." />

<div class="narrow wide">
  <Hint>
    Every piece of work is a task owned by one agent. Working, Waiting (for a reply, an approval, or
    a result), Blocked (needs a person), Completed, or Cancelled.
  </Hint>

  <label class="row">
    <span class="muted">Show</span>

    <select
      value={state}
      onchange={(event) => (state = event.currentTarget.value as TaskState | '')}
    >
      <option value="">all tasks</option>

      {#each TASK_STATES ?? [] as state (state)}
        <option value={state}> {state} </option>
      {/each}
    </select>
  </label>

  <ErrorNote error={tasks.error} />

  {#if tasks.data?.data.length === 0}
    <p class="muted">No tasks.</p>
  {/if}

  <ul class="list">
    {#each tasks.data?.data ?? [] as task (task.id)}
      <li>
        <a href={`#/tasks/${task.id}`}>
          <strong>{task.title}</strong>
        </a>

        <StateBadge state={task.state} paused={Boolean(task.pausedAt)} />

        <div class="muted small">
          <span class="row"
            ><Avatar
              name={name({ type: 'agent', id: task.ownerAgentId })}
              id={task.ownerAgentId}
              agent
              size="sm"
            />{name({ type: 'agent', id: task.ownerAgentId })}<span class="agent-label">agent</span
            ></span
          >
          asked by
          {name({ type: task.requestedByType, id: task.requestedById })} ·
          {formatDateTime(task.createdAt)}
          {#if task.stateReason}{` · ${task.stateReason}`}{/if}
        </div>
      </li>
    {/each}
  </ul>
</div>
