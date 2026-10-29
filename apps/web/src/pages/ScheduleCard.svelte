<script lang="ts">
  import { api, type Responsibility, type Task, type Conversation } from '../api';
  import Avatar from '../Avatar.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import StateBadge from '../StateBadge.svelte';
  import ScheduleBadge from './ScheduleBadge.svelte';
  import { policyLabels, summarizeRecurrence, scheduleInstant } from '../schedules';
  import { timeDisplay } from '../time-display.svelte';
  import { createAction, createLoad } from '../state.svelte';

  let { schedule: s, agentName, onChanged }: {
    schedule: Responsibility; agentName: string; onChanged: () => void;
  } = $props();
  let offset = $state(0);
  const runs = createLoad(() => api.list<Task>(`/responsibilities/${s.id}/runs?limit=20&offset=${offset}`), () => [s.id, offset], 10000);
  const conversation = createLoad(() => s.conversationId
    ? api.get<Conversation>(`/conversations/${s.conversationId}`) : Promise.resolve(null), () => [s.conversationId]);
  const action = createAction();
  let notice = $state('');
  const instant = (value: string) => scheduleInstant(value, undefined, timeDisplay.format === '12h');
  async function post(path: string, body: unknown = {}) {
    let task: Task | undefined;
    const ok = await action.run(async () => {
      const result = await api.post<Task>(`/responsibilities/${s.id}${path}`, body);
      if (path === '/runs') task = result;
    });
    if (ok) {
      notice = task ? 'Run started. It appears in recent runs below.'
        : path === '/pause' ? 'Schedule paused.' : path === '/resume' ? 'Schedule resumed.' : 'Schedule cancelled.';
      onChanged(); runs.reload();
    }
  }
</script>

<div class="row wrap"><h2 class="grow" tabindex="-1">{s.title}</h2><ScheduleBadge status={s.status} /></div>
<p class="schedule-meta"><Avatar name={agentName} id={s.agentId} agent size="sm" /> {agentName} · {summarizeRecurrence(s, timeDisplay.format === '12h')}</p>
{#if s.status !== 'cancelled'}
  <div class="row wrap schedule-actions">
    <button class="secondary" disabled={action.busy} onclick={() => post(s.status === 'enabled' ? '/pause' : '/resume')}>{s.status === 'enabled' ? 'Pause schedule' : 'Resume schedule'}</button>
    <button class="secondary" disabled={action.busy} onclick={() => post('/runs')}>Run once now</button>
  </div>
{/if}
<p class="muted small">Pausing or cancelling stops future starts. A run that has already started keeps going. Run once now leaves the recurring schedule unchanged.</p>
<ErrorNote error={action.error} />
<p role="status" class="schedule-notice">{notice}</p>
<div class="schedule-facts">
  <div><h3>What to do each time</h3><p class="body">{s.brief}</p></div>
  <div><h3>Done when</h3><p class="body">{s.completionCriteria}</p></div>
  <div class="grid2">
    <div><h3>Next run</h3><p>{s.status === 'enabled' ? instant(s.nextRunAt) : 'No new runs'}</p></div>
    <div><h3>Post results in</h3><p>{#if s.conversationId}<a href={`#/conversations/${s.conversationId}`}># {conversation.data?.title ?? 'Result conversation'}</a>{:else}Run history only{/if}</p></div>
  </div>
  <div><h3>If runs are missed</h3><p>{policyLabels[s.missedRunPolicy]}.</p></div>
</div>
<h3>Recent runs</h3>
<ErrorNote error={runs.error} />
{#if !runs.data && !runs.error}<p class="muted">Loading runs…</p>{/if}
<ul class="schedule-runs">
  {#if runs.data?.data.length === 0}<li class="muted">No runs yet.</li>{/if}
  {#each runs.data?.data ?? [] as run (run.id)}
    <li><time datetime={run.createdAt} class="grow">{instant(run.createdAt)}</time><StateBadge state={run.state} paused={Boolean(run.pausedAt)} /><a href={`#/tasks/${run.id}`}>See what it did</a></li>
  {/each}
</ul>
{#if offset > 0 || (runs.data?.page.total ?? 0) > offset + 20}
  <div class="row wrap"><button class="secondary" disabled={offset === 0} onclick={() => (offset = Math.max(0, offset - 20))}>Newer runs</button><button class="secondary" disabled={(runs.data?.page.total ?? 0) <= offset + 20} onclick={() => (offset += 20)}>Older runs</button></div>
{/if}
{#if s.status !== 'cancelled'}
  <button class="secondary schedule-cancel" disabled={action.busy} onclick={() => {
    if (confirm(`Cancel “${s.title}” permanently? It cannot be resumed. Work already running keeps going.`)) void post('/cancel');
  }}>Cancel schedule…</button>
{/if}
