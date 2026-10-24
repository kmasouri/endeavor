<script lang="ts">
  import { tick } from 'svelte';
  import PageHeader from '../PageHeader.svelte';
  import Avatar from '../Avatar.svelte';
  import Icon from '../Icon.svelte';
  import { api, type Responsibility } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction, createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';
  import { recurrenceSummary, scheduleInstant } from '../schedules';
  import { timeDisplay } from '../time-display.svelte';
  import ScheduleCard from './ScheduleCard.svelte';
  import ScheduleBadge from './ScheduleBadge.svelte';
  import NewSchedule from './NewSchedule.svelte';
  import './schedules.css';

  // Load every page so cancelled schedules cannot hide older active schedules.
  async function loadSchedules(): Promise<Responsibility[]> {
    const all: Responsibility[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await api.list<Responsibility>(`/responsibilities?limit=100&offset=${offset}`);
      all.push(...page.data);
      if (all.length >= page.page.total || !page.data.length) return all;
    }
  }
  const schedules = createLoad(loadSchedules, () => [], 10000);
  const name = createNames();
  let view = $state<'list' | 'new' | 'details'>('list');
  let selected = $state<Responsibility | null>(null);
  let current = $derived(schedules.data?.find((s) => s.id === selected?.id) ?? selected);
  let active = $derived((schedules.data ?? []).filter((s) => s.status !== 'cancelled'));
  let cancelled = $derived((schedules.data ?? []).filter((s) => s.status === 'cancelled'));
  const action = createAction();
  let notice = $state('');
  const instant = (value: string) => scheduleInstant(value, undefined, timeDisplay.format === '12h');
  async function navigate(next: typeof view, schedule: Responsibility | null = null) {
    selected = schedule;
    view = next;
    await tick();
    document.querySelector<HTMLElement>('.schedules-view h2, .schedules-view h3')?.focus();
  }
  async function catchUp(schedule: Responsibility, decision: 'run' | 'wait') {
    if (await action.run(() => api.post(`/responsibilities/${schedule.id}/catch-up`, { decision }))) {
      notice = decision === 'run' ? 'Catch-up run started.' : 'Waiting for the next scheduled run.';
      schedules.reload();
    }
  }
</script>

<PageHeader title="Schedules" subtitle="Recurring work for your agents.">
  {#snippet actions()}{#if view === 'list'}<button onclick={() => navigate('new')}><Icon name="plus" size={16} /> New schedule</button>{/if}{/snippet}
</PageHeader>

<div class="schedules-view">
  <ErrorNote error={schedules.error} />
  <p class="schedule-notice" role="status">{notice}</p>
  {#if view === 'new'}
    <button class="schedule-back" onclick={() => navigate('list')}>← Back to schedules</button>
    <NewSchedule onDiscard={() => navigate('list')} onCreated={() => {
      schedules.reload(); notice = 'Schedule created.'; void navigate('list');
    }} />
  {:else if view === 'details' && current}
    <button class="schedule-back" onclick={() => navigate('list')}>← Back to schedules</button>
    {#key current.id}<ScheduleCard schedule={current} agentName={name({ type: 'agent', id: current.agentId })} onChanged={schedules.reload} />{/key}
  {:else}
    {#each active.filter((s) => s.catchUp) as schedule (schedule.id)}
      <div class="schedule-catchup">
        <strong><Icon name="schedules" size={16} /> {schedule.title} missed {schedule.catchUp!.missed} run{schedule.catchUp!.missed === 1 ? '' : 's'}</strong>
        <p>This computer was off. Run it once now, or wait for the next run at {instant(schedule.nextRunAt)}. If unanswered, this question lapses then.</p>
        <div class="row wrap">
          <button disabled={action.busy} onclick={() => catchUp(schedule, 'run')}>Run once now</button>
          <button class="secondary" disabled={action.busy} onclick={() => catchUp(schedule, 'wait')}>Wait for the next run</button>
        </div>
      </div>
    {/each}
    <ErrorNote error={action.error} />
    <h2 class="schedule-eyebrow" tabindex="-1">Schedules · {active.length}</h2>
    {#if !schedules.data && !schedules.error}<p class="muted">Loading schedules…</p>{/if}
    {#if schedules.data && !active.length}<p class="muted">No active schedules. Create a schedule to set up recurring work.</p>{/if}
    {#snippet rows(items: Responsibility[])}
      {#each items as schedule (schedule.id)}
        <button class="schedule-row" onclick={() => navigate('details', schedule)}>
          <span class="schedule-clock"><Icon name="schedules" /></span>
          <span class="schedule-description">
            <strong>{schedule.title}</strong>
            <span class="schedule-meta"><Avatar name={name({ type: 'agent', id: schedule.agentId })} id={schedule.agentId} agent size="sm" />
              {name({ type: 'agent', id: schedule.agentId })} <span class="agent-label">agent</span>
              <span>· {recurrenceSummary(schedule, timeDisplay.format === '12h')}</span>
            </span>
          </span>
          <span class="schedule-next">{schedule.status === 'enabled' ? instant(schedule.nextRunAt) : 'No new runs'}</span>
          <ScheduleBadge status={schedule.status} />
          <span aria-hidden="true">›</span>
        </button>
      {/each}
    {/snippet}
    <div class="schedule-list">{@render rows(active)}</div>
    {#if cancelled.length}
      <details class="schedule-cancelled"><summary>Cancelled schedules · {cancelled.length}</summary>
        <div class="schedule-list">{@render rows(cancelled)}</div>
      </details>
    {/if}
  {/if}
</div>
