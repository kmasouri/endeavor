<script lang="ts">
  import { tick } from 'svelte';
  import ManagementToolbar from '../ManagementToolbar.svelte';
  import PageHeader from '../PageHeader.svelte';
  import Avatar from '../Avatar.svelte';
  import Icon from '../Icon.svelte';
  import { api, type Project, type Responsibility } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction, createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';
  import { summarizeRecurrence, scheduleInstant } from '../schedules';
  import { timeDisplay } from '../time-display.svelte';
  import ScheduleCard from './ScheduleCard.svelte';
  import ScheduleBadge from './ScheduleBadge.svelte';
  import NewSchedule from './NewSchedule.svelte';
  import './schedules.css';
  import { loadAll } from './agent-data';

  let { project }: { project?: Project } = $props();
  const projects = createLoad(async () => {
    if (project) return [project];
    const [open, archived] = await Promise.all([
      loadAll<Project>('/projects'), loadAll<Project>('/projects?archived=true')
    ]);
    return [...open, ...archived];
  }, () => [project]);
  const projectName = (id: string) => projects.data?.find((project) => project.id === id)?.name ?? 'Project';

  // Load every page so cancelled schedules cannot hide older active schedules.
  async function loadSchedules(): Promise<Responsibility[]> {
    const all: Responsibility[] = [];
    for (let offset = 0; ; offset += 100) {
      const scope = project ? `&projectId=${project.id}` : '';
      const page = await api.list<Responsibility>(`/responsibilities?limit=100&offset=${offset}${scope}`);
      all.push(...page.data);
      if (all.length >= page.page.total || !page.data.length) return all;
    }
  }
  const schedules = createLoad(loadSchedules, () => [project?.id], 10000);
  const name = createNames();
  const starterName = (schedule: Responsibility) => schedule.agentId
    ? name({ type: 'agent', id: schedule.agentId })
    : 'Automatic routing';
  let view = $state<'list' | 'new' | 'details'>('list');
  let selected = $state<Responsibility | null>(null);
  let current = $derived(schedules.data?.find((schedule) => schedule.id === selected?.id) ?? selected);
  const scoped = $derived(schedules.data ?? []);
  let active = $derived(scoped.filter((schedule) => schedule.status !== 'cancelled'));
  let filter = $state('All');
  let search = $state('');
  const shown = $derived(scoped.filter((schedule) =>
    (filter === 'All' || schedule.status === ({ Active: 'enabled', Paused: 'paused', Cancelled: 'cancelled' } as Record<string, string>)[filter]) &&
    `${schedule.title} ${starterName(schedule)} ${projectName(schedule.projectId)} ${summarizeRecurrence(schedule, timeDisplay.format === '12h')}`.toLowerCase().includes(search.trim().toLowerCase())
  ));
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

<div class="schedules-page">
  <PageHeader title="Schedules" subtitle="Recurring work in your projects.">
    {#snippet actions()}{#if view === 'list'}<button disabled={Boolean(project?.archivedAt)} onclick={() => navigate('new')}><Icon name="plus" size={16} /> Create schedule</button>{/if}{/snippet}
  </PageHeader>

  <div class="schedules-view">
    <ErrorNote error={schedules.error ?? projects.error} />
    <p class="schedule-notice" role="status">{notice}</p>
    {#if view === 'new'}
      <button class="schedule-back" onclick={() => navigate('list')}>← Back to schedules</button>
      <NewSchedule {project} projects={projects.data ?? []} onDiscard={() => navigate('list')} onCreated={() => {
        schedules.reload(); notice = 'Schedule created.'; void navigate('list');
      }} />
    {:else if view === 'details' && current}
      <button class="schedule-back" onclick={() => navigate('list')}>← Back to schedules</button>
      {#key current.id}<ScheduleCard appearance={current.agentId ? name.agent(current.agentId) : undefined} schedule={current} agentName={starterName(current)} projectName={projectName(current.projectId)} onChanged={schedules.reload} />{/key}
    {:else}
      {#each active.filter((schedule) => schedule.catchUp) as schedule (schedule.id)}
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
      {#if schedules.data}
        <ManagementToolbar name="schedules" filters={['All', 'Active', 'Paused', 'Cancelled']} bind:filter bind:search />
        <h2 class="schedule-eyebrow" tabindex="-1">Schedules · {shown.length}</h2>
      {/if}
      {#if !schedules.data && !schedules.error}<p class="muted">Loading schedules…</p>{/if}
      {#if schedules.data && scoped.length === 0 && !schedules.error}
        <section class="schedule-empty" aria-labelledby="schedules-empty-title">
          <div class="schedule-empty-clock"><Icon name="schedules" /></div>
          <h2 id="schedules-empty-title" tabindex="-1">No schedules yet</h2>
          <p>Set up recurring work that opens a new endeavor on each run.</p>
        </section>
      {/if}
      {#snippet rows(items: Responsibility[])}
        {#each items as schedule (schedule.id)}
          <button class="schedule-row" onclick={() => navigate('details', schedule)}>
            <span class="schedule-clock"><Icon name="schedules" /></span>
            <span class="schedule-description">
              <strong>{schedule.title}</strong>
              <span class="schedule-meta">{#if schedule.agentId}<Avatar name={starterName(schedule)} id={schedule.agentId} appearance={name.agent(schedule.agentId)} agent size="sm" />{/if}
                {starterName(schedule)} · {projectName(schedule.projectId)}
                <span>· {summarizeRecurrence(schedule, timeDisplay.format === '12h')}</span>
              </span>
            </span>
            <span class="schedule-next">{schedule.status === 'enabled' ? instant(schedule.nextRunAt) : 'No new runs'}</span>
            <ScheduleBadge status={schedule.status} />
            <span aria-hidden="true">›</span>
          </button>
        {/each}
      {/snippet}
      <div class="schedule-list" aria-label="Schedules">{@render rows(shown)}</div>
      {#if scoped.length && !shown.length}<p class="muted">No schedules match your filters.</p>{/if}
    {/if}
  </div>
</div>
