<script lang="ts">
  import { api, type TaskDetails } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { go, createAction } from '../state.svelte';
  import PendingApprovals from './PendingApprovals.svelte';

  let props: {
    task: TaskDetails;
    latestVersionId?: string;
    onDone: () => void;
  } = $props();
  let task = $derived(props.task);
  let reason = $state('');
  const action = createAction();
  let finished = $derived(task.state === 'completed' || task.state === 'cancelled');
  const act = (path: string) =>
    void action
      .run(async () => {
        const result = await api.post<{
          id: string;
        }>(`/tasks/${task.id}/${path}`, reason ? { reason } : {});
        if (path === 'restart') {
          go(`/tasks/${result.id}`);
        }
      })
      .then((ok) => ok && ((reason = ''), props.onDone()));
</script>

<div class="panel stack">
  <h2>Direct this work</h2>

  <Hint>
    To add information or redirect it, write to the agent in the conversation. These buttons stop or
    start the work itself.
  </Hint>

  <input
    bind:value={reason}
    placeholder={finished ? 'What should change? (for Ask for changes)' : 'Reason (optional)'}
  />

  <div class="row wrap">
    {#if !finished && !task.pausedAt}
      <button class="secondary" disabled={action.busy} onclick={() => act('pause')}> Pause </button>
    {/if}

    {#if !finished && (task.pausedAt || task.state === 'blocked')}
      <button disabled={action.busy} onclick={() => act('resume')}> Resume </button>
    {/if}

    {#if !finished}
      <button class="secondary" disabled={action.busy} onclick={() => act('cancel')}>
        Cancel
      </button>
    {/if}

    {#if finished}
      <button
        disabled={action.busy || !reason.trim()}
        title="Write what to change in the box above"
        onclick={() => act('restart')}
      >
        Ask for changes
      </button>
    {/if}

    {#if finished}
      <button class="secondary" disabled={action.busy} onclick={() => act('restart')}>
        Restart as a new run
      </button>
    {/if}

    {#if !finished && props.latestVersionId && props.latestVersionId !== task.agentVersionId}
      <button class="secondary" disabled={action.busy} onclick={() => act('version')}>
        Move to the agent's newest version
      </button>
    {/if}
  </div>

  <ErrorNote error={action.error} />

  <PendingApprovals taskId={task.id} onDone={props.onDone} />
</div>
