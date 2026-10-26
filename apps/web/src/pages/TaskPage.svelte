<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import {
    type AgentVersion,
    api,
    type TaskDetails,
    type TaskEvent,
    type TaskOutput
  } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
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
    taskId
  }: {
    taskId: string;
  } = $props();
  const task = createLoad(
    () => api.get<TaskDetails>(`/tasks/${taskId}`),
    () => [taskId],
    4000
  );
  const outputs = createLoad(
    () => api.get<TaskOutput[]>(`/tasks/${taskId}/outputs`),
    () => [taskId],
    4000
  );
  const events = createLoad(
    () => api.get<TaskEvent[]>(`/tasks/${taskId}/events?limit=500`),
    () => [taskId],
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
  let version = $derived(versions.data?.find((candidate) => candidate.id === loadedTask.agentVersionId));
  let latest = $derived(versions.data?.[0]);
  const reload = () => (task.reload(), events.reload(), outputs.reload());
</script>

{#if task.error}
  <ErrorNote error={task.error} />
{:else if !task.data}
  <p>Loading…</p>
{:else}
  <PageHeader title={loadedTask.title} subtitle="Work, outputs, and execution history." />
  <div class="columns">
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

      <ReviewPanel task={loadedTask} onDone={reload} />

      <div class="panel">
        <h2>Outputs and evidence</h2>

        {#if (outputs.data ?? []).length === 0}
          <p class="muted">Nothing attached yet.</p>
        {/if}

        {#each outputs.data ?? [] as output (output.id)}
          <div>
            <strong>{output.title}</strong>
            <span class="badge">{output.kind}</span>

            <span class="muted small">{formatDateTime(output.createdAt)}</span>

            {#if output.uri}
              <div>
                <a href={output.uri} target="_blank" rel="noreferrer"> {output.uri} </a>
              </div>
            {/if}

            {#if output.content}
              <pre>{output.content}</pre>
            {/if}
          </div>
        {/each}
      </div>

      <div class="panel">
        <h2>History</h2>

        <Hint>
          Everything that happened, oldest first: state changes, model turns, and tool calls.
        </Hint>

        <ol class="events">
          {#each events.data ?? [] as event (event.id)}
            <li>
              <strong>{event.type}</strong>

              <span class="muted small"> {name(event.actor)} · {formatDateTime(event.createdAt)} </span>

              <EventDetail {event} />
            </li>
          {/each}
        </ol>
      </div>
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

      <Controls task={loadedTask} latestVersionId={latest?.id} onDone={reload} />

      <TaskAccess {taskId} open={!['completed', 'cancelled'].includes(loadedTask.state)} />

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
