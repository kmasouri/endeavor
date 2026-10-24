<script lang="ts">
  import { api, type CostReport, type Task, type TaskDetails } from '../api';
  import { createAction, createLoad } from '../state.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  let { task, costs, onChanged }: { task: Task; costs?: CostReport; onChanged: () => void } =
    $props();
  const details = createLoad(
    () =>
      task.state === 'waiting'
        ? api.get<TaskDetails>(`/tasks/${task.id}`)
        : Promise.resolve(undefined),
    () => [task.id, task.state],
    5000
  );
  const action = createAction();
  let newBudget = $derived(
    costs?.budgetUsd != null
      ? Math.max(costs.budgetUsd * 2, Math.ceil((costs.total.costUsd + 1) * 100) / 100)
      : null
  );
  let conversationBudget = $derived(
    task.state === 'blocked' &&
      task.stateReason?.startsWith('This conversation spent') &&
      task.conversationId &&
      newBudget !== null
  );
  const resume = () =>
    void action
      .run(async () => {
        if (conversationBudget)
          await api.patch(`/conversations/${task.conversationId}`, { budgetUsd: newBudget });
        await api.post(`/tasks/${task.id}/resume`);
      })
      .then((ok) => ok && onChanged());
</script>

{#if task.pausedAt || task.state === 'blocked' || task.state === 'waiting'}
  <div
    class="task-status"
    class:waiting={task.state === 'waiting' && !task.pausedAt}
    class:stuck={task.state === 'blocked' && !task.pausedAt}
  >
    <strong>{task.pausedAt ? 'Paused' : task.state === 'blocked' ? 'Stuck' : 'Waiting'}</strong>
    {#if task.stateReason}<p>{task.stateReason}</p>{/if}
    {#if !task.pausedAt && task.state === 'waiting'}{#each details.data?.waits.filter((w) => !w.resolvedAt) ?? [] as wait (wait.id)}<p
        >
          {wait.description}
        </p>{/each}<ErrorNote error={details.error} />{/if}
    {#if task.pausedAt}<button disabled={action.busy} onclick={resume}>Resume</button>
    {:else if conversationBudget}<button disabled={action.busy} onclick={resume}
        >Raise budget to ${newBudget?.toFixed(2)} and continue</button
      >
    {:else if task.state === 'blocked'}<a class="secondary" href={`#/tasks/${task.id}`}
        >Resolve this work</a
      >{/if}
    <ErrorNote error={action.error} />
  </div>
{/if}
