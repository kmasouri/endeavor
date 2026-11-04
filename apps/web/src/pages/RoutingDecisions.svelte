<script lang="ts">
  import { api } from '../api';
  import { createLoad } from '../state.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  interface Decision {
    id: string; kind: 'starter' | 'handoff'; status: string;
    selectedAgentId: string | null; reason: string; revision: number;
    candidates: { id: string; name: string }[];
  }
  let { conversationId }: { conversationId: string } = $props();
  const decisions = createLoad(() => api.list<Decision>(`/conversations/${conversationId}/routing`), () => [conversationId], 2000);
  let editing = $state<string | null>(null);
  let busy = $state(false);
  let error = $state('');
  $effect(() => { conversationId; editing = null; error = ''; });
  async function choose(decision: Decision, agentId: string | null) {
    const id = conversationId;
    busy = true; error = '';
    try {
      await api.post(`/conversations/${id}/routing/${decision.id}/choice`, { agentId, revision: decision.revision });
      if (id === conversationId) { editing = null; await decisions.reload(); }
    } catch (failure) { if (id === conversationId) error = (failure as Error).message; }
    finally { busy = false; }
  }
</script>

{#if decisions.data?.data.length}
  <section class="routing-decisions" aria-label="Routing decisions">
    {#each decisions.data.data as decision (decision.id)}
      <article class="routing-decision">
        <p>{decision.reason}</p>
        {#if decision.status === 'waiting' || editing === decision.id}
          <div class="routing-options" aria-label="Choose who acts next">
            {#each decision.candidates as agent (agent.id)}
              <button class="btn btn-sm" disabled={busy} onclick={() => choose(decision, agent.id)}>{agent.name}</button>
            {/each}
            <button class="btn btn-sm" disabled={busy} onclick={() => choose(decision, null)}>No one</button>
            {#if editing === decision.id}<button class="btn btn-sm" onclick={() => editing = null}>Cancel</button>{/if}
          </div>
        {:else}
          <button class="btn btn-sm" onclick={() => editing = decision.id}>Change agent</button>
        {/if}
      </article>
    {/each}
    <ErrorNote {error} />
  </section>
{/if}

<style>
  .routing-decisions { display: grid; gap: var(--space-2); margin: var(--space-3) 0; }
  .routing-decision { padding: var(--space-3); border: 1px solid var(--border-100); border-radius: var(--radius-md); background: var(--bg-100); }
  p { margin: 0 0 var(--space-2); color: var(--text-300); font-size: 13px; }
  .routing-options { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
