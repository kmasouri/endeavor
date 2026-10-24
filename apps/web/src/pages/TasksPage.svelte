<script lang="ts">
  import { api, type Task, TASK_STATES, type TaskState } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import StateBadge from '../StateBadge.svelte';
  import { when } from '../components';
  import { createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';

  let state = $state<TaskState | ''>('');
  const tasks = createLoad(
    () => api.list<Task>(`/tasks?limit=100${state ? `&state=${state}` : ''}`),
    () => [state],
    5000
  );
  const name = createNames();
</script>

<div class="narrow wide">
  <h1>Work</h1>

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

      {#each TASK_STATES ?? [] as s (s)}
        <option value={s}> {s} </option>
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
          {name({ type: 'agent', id: task.ownerAgentId })} · asked by
          {name({ type: task.requestedByType, id: task.requestedById })} ·
          {when(task.createdAt)}
          {#if task.stateReason}{` · ${task.stateReason}`}{/if}
        </div>
      </li>
    {/each}
  </ul>
</div>
