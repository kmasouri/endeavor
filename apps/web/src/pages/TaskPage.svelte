<script lang="ts">
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
  import { when } from '../components';
  import { createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';
  import EventDetail from './EventDetail.svelte';
  import OpenConcerns from './OpenConcerns.svelte';
  import ReviewPanel from './ReviewPanel.svelte';
  import Controls from './Controls.svelte';

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
  let t = $derived(task.data!);
  let version = $derived(versions.data?.find((v) => v.id === t.agentVersionId));
  let latest = $derived(versions.data?.[0]);
  const reload = () => (task.reload(), events.reload(), outputs.reload());
</script>

{#if task.error}
  <ErrorNote error={task.error} />
{:else if !task.data}
  <p>Loading…</p>
{:else}
  <div class="columns">
    <section>
      <p>
        <a href="#/tasks">← Work</a>
      </p>

      <h1>
        {t.title}
        <StateBadge state={t.state} paused={Boolean(t.pausedAt)} />
      </h1>

      {#if t.stateReason}
        <p class={t.state === 'blocked' ? 'error' : 'muted'}>
          {t.stateReason}
        </p>
      {/if}

      <div class="panel">
        <h2>The request</h2>

        <p class="body">{t.brief}</p>

        <h3>Done when</h3>

        <p class="body">{t.completionCriteria}</p>

        {#if t.criteriaCheck}
          <h3>Agent's check against the criteria</h3>

          <p class="body">
            {#if t.criteriaCheck.met}Met.
            {:else}Not met.
            {/if}
            {t.criteriaCheck.summary}
          </p>
        {/if}

        {#if t.review}
          <p class="muted">
            Reviewed:
            {#if t.review.approved}approved{:else}sent back{/if}

            {#if t.review.notes}{` (${t.review.notes})`}{/if}
          </p>
        {/if}
      </div>

      <OpenConcerns task={t} events={events.data ?? []} />

      <ReviewPanel task={t} onDone={reload} />

      <div class="panel">
        <h2>Outputs and evidence</h2>

        {#if (outputs.data ?? []).length === 0}
          <p class="muted">Nothing attached yet.</p>
        {/if}

        {#each outputs.data ?? [] as output (output.id)}
          <div>
            <strong>{output.title}</strong>
            <span class="badge">{output.kind}</span>

            <span class="muted small">{when(output.createdAt)}</span>

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

              <span class="muted small"> {name(event.actor)} · {when(event.createdAt)} </span>

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
            <a href={`#/agents/${t.ownerAgentId}`}>
              {name({ type: 'agent', id: t.ownerAgentId })}
            </a>
          </li>

          <li>
            Configuration: version {version?.version ?? '…'}
            {#if latest && version && latest.id !== version.id}
              <span class="muted"> (the agent is now on version {latest.version})</span>
            {/if}
          </li>

          <li>
            Asked by: {name({ type: t.requestedByType, id: t.requestedById })},
            {when(t.createdAt)}
          </li>

          {#if t.conversationId}
            <li>
              <a href={`#/conversations/${t.conversationId}`}>Open the conversation</a>
            </li>
          {/if}

          {#if t.parentTaskId}
            <li>
              Helping with
              <a href={`#/tasks/${t.parentTaskId}`}>another task</a>
            </li>
          {/if}

          {#if t.restartedFromTaskId}
            <li>
              Restarted from
              <a href={`#/tasks/${t.restartedFromTaskId}`}>an earlier run</a>
            </li>
          {/if}

          {#if t.responsibilityId}
            <li>
              A run of a
              <a href="#/schedules">schedule</a>
            </li>
          {/if}
        </ul>
      </div>

      <Controls task={t} latestVersionId={latest?.id} onDone={reload} />

      <div class="panel">
        <h2>Waiting on</h2>

        {#if t.waits.length === 0}
          <p class="muted">Nothing.</p>
        {/if}

        <ul class="list small">
          {#each t.waits ?? [] as wait (wait.id)}
            <li>
              {wait.description}
              <span class="badge">{wait.kind}</span>

              <div class="muted">
                {#if wait.resolvedAt}{`Done ${when(wait.resolvedAt)}`}{:else}{`Since ${when(wait.createdAt)}`}{/if}
              </div>
            </li>
          {/each}
        </ul>
      </div>
    </aside>
  </div>
{/if}
