<script lang="ts">
  import { untrack } from 'svelte';
  import { api, type Responsibility, type Task } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import StateBadge from '../StateBadge.svelte';
  import { when } from '../components';
  import { createAction, createLoad } from '../state.svelte';

  const POLICY_LABELS = {
    ask: 'run one, ask if several',
    run_once: 'run once',
    skip: 'skip'
  } as const;

  let props: {
    schedule: Responsibility;
    agentName: string;
    onChanged: () => void;
  } = $props();
  let s = $derived(props.schedule);
  let showRuns = $state(false);
  let interval = $state(untrack(() => String(s.intervalMinutes)));
  const runs = createLoad(
    () =>
      showRuns
        ? api.list<Task>(`/responsibilities/${s.id}/runs?limit=20`)
        : Promise.resolve({ data: [] as Task[], page: { limit: 0, offset: 0, total: 0 } }),
    () => [showRuns]
  );
  const action = createAction();
  const post = (path: string, body: unknown = {}) =>
    void action
      .run(() => api.post(`/responsibilities/${s.id}${path}`, body))
      .then((ok) => ok && (props.onChanged(), runs.reload()));
  const saveInterval = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.patch(`/responsibilities/${s.id}`, { intervalMinutes: Number(interval) }))
      .then((ok) => ok && props.onChanged());
  };


</script>

<div class="panel">
  <div class="row">
    <strong class="grow">
      {s.title}
    </strong>

    <span class={`badge ${s.status === 'enabled' ? 'state-working' : ''}`}>
      {s.status}
    </span>
  </div>

  {#if s.catchUp}
    <div class="callout">
      <strong>
        {#if s.catchUp.missed === 1}
          A run was
        {:else}
          {`${s.catchUp.missed} runs were`}
        {/if}

        missed while the platform was off.
      </strong>

      Run it now, or wait for the next one ({when(s.nextRunAt)})? If you don't answer, the next run
      happens as usual.

      <div class="row">
        <button disabled={action.busy} onclick={() => post('/catch-up', { decision: 'run' })}>
          Catch up now
        </button>

        <button
          class="secondary"
          disabled={action.busy}
          onclick={() => post('/catch-up', { decision: 'wait' })}
        >
          Wait
        </button>
      </div>
    </div>
  {/if}

  <p class="muted small">
    {props.agentName} · every {s.intervalMinutes} minutes ·

    {#if s.status === 'enabled'}
      {`next ${when(s.nextRunAt)}`}
    {:else}
      not running
    {/if}

    {#if s.lastRunAt}
      {` · last ${when(s.lastRunAt)}`}
    {/if}

    · missed runs:
    {POLICY_LABELS[s.missedRunPolicy]}

    {#if s.conversationId}
      ·

      <a href={`#/conversations/${s.conversationId}`}> results go here </a>
    {/if}
  </p>

  <details>
    <summary> Brief and criteria </summary>

    <p class="body small">
      {s.brief}
    </p>

    <p class="body small">
      <strong> Done when: </strong>

      {s.completionCriteria}
    </p>
  </details>

  {#if s.status !== 'cancelled'}
    <div class="row wrap">
      {#if s.status === 'enabled'}
        <button class="secondary" disabled={action.busy} onclick={() => post('/pause')}>
          Pause
        </button>
      {:else}
        <button disabled={action.busy} onclick={() => post('/resume')}> Resume </button>
      {/if}

      <button class="secondary" disabled={action.busy} onclick={() => post('/runs', {})}>
        Run now
      </button>

      <button
        class="secondary"
        disabled={action.busy}
        onclick={() =>
          confirm('Cancel this schedule for good? Running work keeps going.') && post('/cancel')}
      >
        Cancel schedule
      </button>

      <form onsubmit={saveInterval} class="row">
        <input
          inputmode="numeric"
          bind:value={interval}
          style="width: 5rem"
          aria-label="Interval in minutes"
        />

        <button class="secondary" disabled={action.busy || interval === String(s.intervalMinutes)}>
          Set minutes
        </button>
      </form>
    </div>
  {/if}

  <ErrorNote error={action.error} />

  <label class="check">
    <input type="checkbox" bind:checked={showRuns} />

    Show runs
  </label>

  {#if showRuns}
    <ul class="list small">
      {#if (runs.data?.data ?? []).length === 0}
        <li class="muted">No runs yet.</li>
      {/if}

      {#each runs.data?.data ?? [] as run (run.id)}
        <li>
          <a href={`#/tasks/${run.id}`}>
            {when(run.createdAt)}
          </a>

          <StateBadge state={run.state} paused={Boolean(run.pausedAt)} />
        </li>
      {/each}
    </ul>
  {/if}
</div>
