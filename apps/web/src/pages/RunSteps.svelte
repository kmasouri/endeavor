<script lang="ts">
  import { api, type TaskEvent } from '../api';
  import { createLoad } from '../state.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import EventDetail from './EventDetail.svelte';
  let { taskId }: { taskId: string } = $props();
  let open = $state(false);
  const events = createLoad(
    () =>
      open ? api.get<TaskEvent[]>(`/tasks/${taskId}/events?limit=500`) : Promise.resolve(undefined),
    () => [taskId, open]
  );
</script>

<details class="run-steps" ontoggle={(e) => (open = e.currentTarget.open)}>
  <summary
    >Agent's steps{#if events.data}
      · {events.data.length} events{/if}</summary
  >
  <ErrorNote error={events.error} />
  {#if open && !events.data && !events.error}<p class="muted">Loading steps…</p>{/if}
  <ol class="events">
    {#each events.data ?? [] as event (event.id)}<li>
        <strong>{event.type}</strong><EventDetail {event} />
      </li>{/each}
  </ol>
</details>
