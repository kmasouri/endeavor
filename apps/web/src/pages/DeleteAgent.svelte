<script lang="ts">
  import { api, type Agent } from '../api';
  import Modal from '../Modal.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction, createLoad } from '../state.svelte';
  let { agent, onClose }: { agent: Agent; onClose: () => void } = $props();
  type Impact = {
    tasks: { id: string; title: string; state: string }[];
    schedules: { id: string; title: string; status: string }[];
  };
  const impact = createLoad(() => api.get<Impact>(`/agents/${agent.id}/deletion-impact`), () => [agent.id]);
  const action = createAction();
  let confirmation = $state('');
  let confirmed = $derived(confirmation === agent.name);
  const remove = () => {
    if (!confirmed || !impact.data || impact.error || action.busy) return;
    void action.run(async () => {
      await api.delete(`/agents/${agent.id}`);
      onClose();
      location.hash = '#/agents';
    });
  };
</script>

<Modal title={`Delete ${agent.name}?`} busy={action.busy} {onClose}>
  <div class="stack">
    <p>This permanently deletes {agent.name} and cannot be undone. Its schedules and open tasks will be cancelled.</p>
    <p>Shared messages, outputs, and cost history stay available, attributed to “Deleted agent.”</p>
    {#if impact.data}
      <h3>Schedules to cancel · {impact.data.schedules.length}</h3>
      {#if impact.data.schedules.length}<ul>{#each impact.data.schedules as schedule (schedule.id)}<li>{schedule.title} · {schedule.status}</li>{/each}</ul>{/if}
      <h3>Open tasks to cancel · {impact.data.tasks.length}</h3>
      {#if impact.data.tasks.length}<ul>{#each impact.data.tasks as task (task.id)}<li>{task.title} · {task.state}</li>{/each}</ul>{/if}
      <p class="caption muted">Any work started before deletion completes will also be cancelled. Calls already in progress finish before deletion completes.</p>
    {:else if !impact.error}<p>Checking affected work…</p>{/if}
    <ErrorNote error={impact.error ?? action.error} />
    {#if impact.error}<button class="secondary" onclick={impact.reload}>Retry</button>{/if}
    <label for="delete-agent-name"><span>Type <strong>{agent.name}</strong> to confirm deletion.</span>
      <input id="delete-agent-name" bind:value={confirmation} disabled={action.busy}
        autocomplete="off" autocapitalize="none" spellcheck={false} />
    </label>
    <footer class="dialog-footer">
      <button class="secondary" disabled={action.busy} onclick={onClose}>Cancel</button>
      <button class="agent-delete-confirm" disabled={action.busy || !impact.data || Boolean(impact.error) || !confirmed} onclick={remove}>{action.busy ? 'Deleting…' : 'Delete permanently'}</button>
    </footer>
  </div>
</Modal>
