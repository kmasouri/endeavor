<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import { api, type Responsibility } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';
  import ScheduleCard from './ScheduleCard.svelte';
  import NewSchedule from './NewSchedule.svelte';

  const schedules = createLoad(
    () => api.list<Responsibility>('/responsibilities?limit=100'),
    () => [],
    10000
  );
  const name = createNames();
</script>

<PageHeader title="Schedules" subtitle="Recurring work and its next run.">
  {#snippet actions()}<button
      onclick={() =>
        document
          .getElementById('new-schedule')
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>New schedule</button
    >{/snippet}
</PageHeader>

<div class="columns">
  <section>
    <Hint>
      A schedule is work an agent does again and again, with nobody asking each time. Each run is an
      ordinary task. Pausing or cancelling a schedule never stops a run that's already going; cancel
      that task separately.
    </Hint>

    <ErrorNote error={schedules.error} />

    {#if schedules.data?.data.length === 0}
      <p class="muted">No schedules yet.</p>
    {/if}

    {#each schedules.data?.data ?? [] as schedule (schedule.id)}
      <ScheduleCard
        {schedule}
        agentName={name({ type: 'agent', id: schedule.agentId })}
        onChanged={schedules.reload}
      />
    {/each}
  </section>

  <aside class="panel" id="new-schedule">
    <NewSchedule onCreated={schedules.reload} />
  </aside>
</div>
