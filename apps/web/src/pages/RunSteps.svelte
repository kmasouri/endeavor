<script lang="ts">
  import { api, type TaskEvent } from '../api';
  import { createLoad } from '../state.svelte';
  import { buildAgentSteps } from '../agent-steps';
  import ErrorNote from '../ErrorNote.svelte';
  let { taskId, onInspect }: { taskId: string; onInspect?: (id: string) => void } = $props();
  const runId = $derived(taskId);
  let open = $state(false);
  let requested = $state(false);
  let loading = $state(false);
  let showAll = $state(false);
  const events = createLoad(
    async () => {
      if (!requested) return undefined;
      loading = true;
      try {
        return await api.get<TaskEvent[]>(`/tasks/${runId}/events?limit=500`);
      } finally {
        loading = false;
      }
    },
    () => [runId, requested]
  );
  let steps = $derived(buildAgentSteps(events.data ?? []));
  let visible = $derived(showAll ? steps : steps.slice(0, 6));
  let panelId = $derived(`steps-${runId}`);
  const toggle = () => {
    if (!open) {
      requested = true;
      showAll = false;
    }
    open = !open;
  };
</script>

<div class="run-steps">
  <button class="run-steps-toggle" aria-expanded={open} aria-controls={panelId} onclick={toggle}>
    <svg
      class:expanded={open}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg
    >
    {steps.length ? `${steps.length} steps` : 'See steps'}
  </button>
  {#if open}
    <section class="run-step-body" id={panelId} aria-label="Agent's steps">
      {#if loading && !events.data}<p class="caption muted" role="status">Loading steps…</p>
      {:else if events.error}<ErrorNote error={events.error} /><button
          class="text-button"
          disabled={loading}
          onclick={events.reload}>Try again</button
        >
      {:else if events.data}
        {#if steps.length}
          <ol class="work-steps">
            {#each visible as step (step.id)}<li class:step-error={step.kind === 'error'}>
                <span>{step.title}</span>{#if step.detail}<span class="caption muted step-detail"
                    >{step.detail}</span
                  >{/if}
              </li>{/each}
          </ol>
          {#if steps.length > 6}<button
              class="text-button"
              aria-expanded={showAll}
              onclick={() => (showAll = !showAll)}
              >{showAll ? 'Show fewer steps' : `Show all ${steps.length} steps`}</button
            >{/if}
        {:else}<p class="caption muted">No work steps recorded yet.</p>{/if}
      {/if}
      <div class="step-footer">
        {#if onInspect}<button class="text-button" onclick={() => onInspect?.(runId)}>Open full run</button>{:else}<a href={`#/tasks/${runId}`}>Open full run</a>{/if}{#if events.data}<button
            class="text-button"
            disabled={loading}
            onclick={events.reload}>{loading ? 'Refreshing…' : 'Refresh'}</button
          >{/if}
      </div>
    </section>
  {/if}
</div>
