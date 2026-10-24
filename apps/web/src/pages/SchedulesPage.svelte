<script lang="ts">
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

<div class="columns">
  <section>
    <h1>Schedules</h1>

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

  <aside class="panel">
    <NewSchedule onCreated={schedules.reload} />
  </aside>
</div>
