<script lang="ts">
  import FormattedText from '../FormattedText.svelte';
  import { toSafeHref } from '../message-format';
  import { buildAgentSteps } from '../agent-steps';
  import {
    type AgentVersion,
    api,
    type TaskDetails,
    type TaskEvent,
    type TaskOutput
  } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import StateBadge from '../StateBadge.svelte';
  import { formatDateTime } from '../components';
  import { createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';
  import EventDetail from './EventDetail.svelte';
  import OpenConcerns from './OpenConcerns.svelte';
  import ReviewPanel from './ReviewPanel.svelte';
  import Controls from './Controls.svelte';
  import TaskAccess from './TaskAccess.svelte';

  let {
    taskId,
    conversationId,
    readOnly = false,
    cost,
    onRevise,
    onSelect,
    onChanged = () => {},
    onLoaded
  }: {
    taskId: string;
    conversationId?: string;
    readOnly?: boolean;
    cost?: number;
    onRevise?: (task: TaskDetails) => void;
    onSelect?: (taskId: string) => void;
    onChanged?: () => void;
    onLoaded?: (task: TaskDetails) => void;
  } = $props();
  const task = createLoad(
    async () => {
      const result = await api.get<TaskDetails>(`/tasks/${taskId}`);
      if (conversationId && result.conversationId !== conversationId)
        throw new Error('This run does not belong to this Endeavor.');
      return result;
    },
    () => [taskId, conversationId],
    4000
  );
  const outputs = createLoad(
    () =>
      task.data
        ? api.get<TaskOutput[]>(`/tasks/${task.data.id}/outputs`)
        : Promise.resolve(undefined),
    () => [task.data?.id],
    4000
  );
  const events = createLoad(
    async () => {
      if (!task.data) return undefined;
      const id = task.data.id;
      const all: TaskEvent[] = [];
      let afterId = 0;
      for (;;) {
        const page = await api.get<TaskEvent[]>(`/tasks/${id}/events?limit=500&afterId=${afterId}`);
        all.push(...page);
        if (page.length < 500) return all;
        const next = page.at(-1)!.id;
        if (next <= afterId) throw new Error('Could not load older events. Try again.');
        afterId = next;
      }
    },
    () => [task.data?.id],
    4000
  );
  const versions = createLoad(
    () =>
      task.data
        ? api.get<AgentVersion[]>(`/agents/${task.data.ownerAgentId}/versions`)
        : Promise.resolve([]),
    () => [task.data?.ownerAgentId]
  );
  const name = createNames();
  let loadedTask = $derived(task.data!);
  let version = $derived(
    versions.data?.find((candidate) => candidate.id === loadedTask.agentVersionId)
  );
  let latest = $derived(versions.data?.[0]);
  const reload = () => (task.reload(), events.reload(), outputs.reload(), onChanged());
  let steps = $derived(buildAgentSteps(events.data ?? []));
  $effect(() => {
    if (task.data) onLoaded?.(task.data);
  });
</script>

{#if task.error}
  <ErrorNote error={task.error} /><button class="secondary" onclick={task.reload}>Try again</button>
{:else if !task.data}
  <p>Loading…</p>
{:else}
  <div class="run-heading"><h3 class="run-title">{loadedTask.title}</h3>
  <p class="caption muted">{name({ type: 'agent', id: loadedTask.ownerAgentId })} · {formatDateTime(loadedTask.createdAt)}{#if cost !== undefined} · ${cost.toFixed(2)}{/if}</p></div>
  <div class="run-inspector">
    <section>
      <StateBadge state={loadedTask.state} paused={Boolean(loadedTask.pausedAt)} />

      {#if loadedTask.stateReason}
        <p class={loadedTask.state === 'blocked' ? 'error' : 'muted'}>
          {loadedTask.stateReason}
        </p>
      {/if}

      <div class="panel">
        <h2>The request</h2>

        <p class="body">{loadedTask.brief}</p>

        <h3>Done when</h3>

        <p class="body">{loadedTask.completionCriteria}</p>

        {#if loadedTask.criteriaCheck}
          <h3>Agent's check against the criteria</h3>

          <p class="body">
            {#if loadedTask.criteriaCheck.met}Met.
            {:else}Not met.
            {/if}
            {loadedTask.criteriaCheck.summary}
          </p>
        {/if}

        {#if loadedTask.review}
          <p class="muted">
            Reviewed:
            {#if loadedTask.review.approved}approved{:else}sent back{/if}

            {#if loadedTask.review.notes}{` (${loadedTask.review.notes})`}{/if}
          </p>
        {/if}
      </div>

      <OpenConcerns task={loadedTask} events={events.data ?? []} />

      {#if !readOnly}<ReviewPanel task={loadedTask} onDone={reload} />{/if}

      <div class="panel">
        <h2>Outputs and evidence</h2>

        <ErrorNote error={outputs.error} />
        {#if outputs.error}<button class="secondary" onclick={outputs.reload}>Retry outputs</button>
        {:else if !outputs.data}<p role="status">Loading outputs…</p>
        {:else if outputs.data.length === 0}
          <p class="muted">Nothing attached yet.</p>
        {/if}

        {#each outputs.data ?? [] as output (output.id)}
          <div>
            <strong>{output.title}</strong>
            <span class="badge">{output.kind}</span>

            <span class="muted small">{formatDateTime(output.createdAt)}</span>

            {#if output.uri}
              <div>{#if toSafeHref(output.uri)}<a href={toSafeHref(output.uri)!} target="_blank" rel="noreferrer">{output.uri}</a>{:else}<span class="muted">{output.uri}</span>{/if}</div>
            {/if}

            {#if output.content}
              <FormattedText text={output.content} />
            {/if}
          </div>
        {/each}
      </div>

      <section class="run-history">
        <h2>What it did</h2>
        {#if events.error}<ErrorNote error={events.error} /><button class="secondary" onclick={events.reload}>Retry history</button>
        {:else if !events.data}<p role="status">Loading execution history…</p>
        {:else}
          <ol class="work-steps">
            {#each steps as step (step.id)}<li class:step-error={step.kind === 'error'}><span>{step.title}</span>{#if step.detail}<span class="caption muted step-detail">{step.detail}</span>{/if}</li>{/each}
          </ol>
          {#if !steps.length}<p class="muted">No work steps recorded yet.</p>{/if}
          <details class="technical-events"><summary>Technical events · {events.data.length}</summary>
            <ol class="events">
              {#each events.data as event (event.id)}<li><strong>{event.type}</strong><span class="muted small"> {name(event.actor)} · {formatDateTime(event.createdAt)}</span><EventDetail {event} /><details><summary>Recorded data</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details></li>{/each}
            </ol>
          </details>
        {/if}
      </section>
    </section>

    <aside>
      <div class="panel">
        <h2>About</h2>

        <ul class="list small">
          <li>
            Owner:
            <a href={`#/agents/${loadedTask.ownerAgentId}`}>
              {name({ type: 'agent', id: loadedTask.ownerAgentId })}
            </a>
          </li>

          <li>
            Configuration: version {version?.version ?? '…'}
            {#if latest && version && latest.id !== version.id}
              <span class="muted"> (the agent is now on version {latest.version})</span>
            {/if}
          </li>

          <li>
            Asked by: {name({ type: loadedTask.requestedByType, id: loadedTask.requestedById })},
            {formatDateTime(loadedTask.createdAt)}
          </li>

          {#if loadedTask.conversationId}
            <li>
              <a href={`#/conversations/${loadedTask.conversationId}`}>Open the conversation</a>
            </li>
          {/if}

          {#if loadedTask.parentTaskId}
            <li>
              Helping with
              <a href={`#/tasks/${loadedTask.parentTaskId}`}>another task</a>
            </li>
          {/if}

          {#if loadedTask.restartedFromTaskId}
            <li>
              Restarted from
              <a href={`#/tasks/${loadedTask.restartedFromTaskId}`}>an earlier run</a>
            </li>
          {/if}

          {#if loadedTask.responsibilityId}
            <li>
              A run of a
              <a href="#/schedules">schedule</a>
            </li>
          {/if}
        </ul>
      </div>

      {#if !readOnly}<Controls task={loadedTask} latestVersionId={latest?.id} onDone={reload} onRevise={() => onRevise?.(loadedTask)} onRestarted={(id) => onSelect?.(id)} />{/if}

      <TaskAccess {taskId} {readOnly} open={!['completed', 'cancelled'].includes(loadedTask.state)} />

      <div class="panel">
        <h2>Waiting on</h2>

        {#if loadedTask.waits.length === 0}
          <p class="muted">Nothing.</p>
        {/if}

        <ul class="list small">
          {#each loadedTask.waits ?? [] as wait (wait.id)}
            <li>
              {wait.description}
              <span class="badge">{wait.kind}</span>

              <div class="muted">
                {#if wait.resolvedAt}{`Done ${formatDateTime(wait.resolvedAt)}`}{:else}{`Since ${formatDateTime(wait.createdAt)}`}{/if}
              </div>
            </li>
          {/each}
        </ul>
      </div>
    </aside>
  </div>
{/if}
