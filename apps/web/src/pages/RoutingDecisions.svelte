<script lang="ts">
  import { api, type DirectoryEntry, type RoutingDecision } from '../api';
  import Avatar from '../Avatar.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import Modal from '../Modal.svelte';

  let {
    conversationId,
    decision,
    directory,
    humanName,
    onChanged,
    embedded = false
  }: {
    conversationId: string;
    decision: RoutingDecision;
    directory: DirectoryEntry[];
    humanName: (id: string | null) => string | undefined;
    onChanged: () => Promise<unknown> | void;
    embedded?: boolean;
  } = $props();
  let choosing = $state(false);
  let query = $state('');
  let confirming = $state<string | null>(null);
  let busy = $state(false);
  let error = $state('');
  let resetKey = '';
  let candidates = $derived(decision.candidates);
  let recommended = $derived(candidates.find((candidate) => candidate.recommended));
  let suggestions = $derived([
    ...(recommended ? [recommended] : []),
    ...candidates.filter((candidate) => candidate.id !== recommended?.id)
  ].slice(0, 5));
  let matches = $derived(candidates.filter((candidate) =>
    `${candidate.name} ${candidate.purpose ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  let selected = $derived(candidates.find((candidate) => candidate.id === decision.selectedAgentId));
  let confirmer = $derived(humanName(decision.decidedByHumanId));

  $effect(() => {
    const key = `${decision.id}:${decision.revision}`;
    if (key === resetKey) return;
    resetKey = key;
    choosing = false;
    query = '';
    confirming = null;
    error = '';
  });

  async function choose(agentId: string | null) {
    busy = true;
    error = '';
    try {
      await api.post(`/conversations/${conversationId}/routing/${decision.id}/choice`, {
        agentId,
        revision: decision.revision
      });
      await onChanged();
    } catch (failure) {
      error = (failure as Error).message;
      await onChanged();
    } finally {
      busy = false;
    }
  }
</script>

<section class="decision-engine" aria-label="Decision Engine message">
  {#if !embedded}<div class="engine-heading">
      <span class="engine-mark" aria-hidden="true">DE</span>
      <div class="grow"><strong>Decision Engine</strong><span class="caption muted">Routing request</span></div>
    </div>
    <p class="reason">{decision.reason}</p>
  {/if}

  {#if decision.status === 'waiting' || choosing}
    {#if recommended && !choosing}
      <div class="recommendation">
        <Avatar name={recommended.name} id={recommended.id} appearance={directory.find((agent) => agent.id === recommended.id)} agent />
        <span class="grow"><span class="caption muted">Recommended</span><strong>{recommended.name}</strong>{#if recommended.purpose}<span class="caption muted">{recommended.purpose}</span>{/if}</span>
      </div>
    {:else if !choosing}<p class="caption muted">No agent was recommended. Work is waiting for a person to decide.</p>{/if}

    {#if !choosing}
      <div class="decision-actions">
        {#if recommended}<button disabled={busy} onclick={() => void choose(recommended!.id)}>Assign {recommended.name}</button>{/if}
        <button class="secondary" disabled={busy} onclick={() => (choosing = true)}>Choose another agent</button>
        <button class="quiet" disabled={busy} onclick={() => void choose(null)}>Leave unassigned</button>
      </div>
      {#if suggestions.length}<p class="suggestions caption muted">Suggestions: {suggestions.map((candidate) => candidate.name).join(' · ')}</p>{/if}
    {:else}
      <label class="agent-search">Find an agent
        <input type="search" bind:value={query} placeholder="Search by name or specialty…" />
      </label>
      <div class="agent-results" role="listbox" aria-label="Eligible agents">
        {#each matches.slice(0, 5) as candidate (candidate.id)}
          <button type="button" class="quiet agent-result" onclick={() => (confirming = candidate.id)}>
            <Avatar name={candidate.name} id={candidate.id} appearance={directory.find((agent) => agent.id === candidate.id)} agent />
            <span class="grow"><strong>{candidate.name}</strong>{#if candidate.purpose}<span class="caption muted">{candidate.purpose}</span>{/if}</span>
            <span>Choose</span>
          </button>
        {:else}<p class="caption muted">No matching eligible agents.</p>{/each}
        <span class="caption muted">{matches.length} matches · showing up to 5</span>
      </div>
      <div class="decision-actions"><button class="secondary" disabled={busy} onclick={() => (choosing = false)}>Cancel</button></div>
    {/if}
  {:else}
    <div class="outcome">
      {#if selected}
        <Avatar name={selected.name} id={selected.id} appearance={directory.find((agent) => agent.id === selected.id)} agent />
        <span><strong>Assigned to {selected.name}</strong><span class="caption muted">{confirmer ? `Chosen by ${confirmer}` : 'Selected by the Decision Engine'}</span></span>
      {:else}<span><strong>Left unassigned</strong><span class="caption muted">{confirmer ? `Chosen by ${confirmer}` : 'Selected by the Decision Engine'}</span></span>{/if}
    </div>
    <button class="secondary" disabled={busy} onclick={() => (choosing = true)}>Change choice</button>
  {/if}
  <ErrorNote {error} />
</section>

{#if confirming}
  {@const candidate = candidates.find((item) => item.id === confirming)!}
  <Modal title={`Assign ${candidate.name}?`} {busy} onClose={() => (confirming = null)}>
    <p>This will assign the request to <strong>{candidate.name}</strong>. Work starts after you confirm.</p>
    {#if candidate.purpose}<p class="muted">{candidate.purpose}</p>{/if}
    <footer class="dialog-footer">
      <button class="secondary" disabled={busy} onclick={() => (confirming = null)}>Cancel</button>
      <button disabled={busy} onclick={() => void choose(candidate.id)}>{busy ? 'Assigning…' : `Assign ${candidate.name}`}</button>
    </footer>
  </Modal>
{/if}

<style>
  .decision-engine { display: grid; gap: var(--space-3); margin-top: var(--space-3); padding: var(--space-3); border: 1px solid var(--border-100); border-radius: var(--radius-md); background: var(--bg-100); }
  .engine-heading, .recommendation, .outcome, .agent-result { display: flex; align-items: center; gap: var(--space-2); }
  .engine-heading .grow, .recommendation .grow, .agent-result .grow, .outcome span { display: grid; }
  .engine-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-sm); background: var(--agent-2-bg); color: var(--agent-2-ink); font-size: 11px; font-weight: 800; letter-spacing: .04em; }
  .reason { margin: 0; color: var(--text-300); }
  .recommendation, .outcome { padding: var(--space-2); border-radius: var(--radius-sm); background: var(--bg-200); }
  .decision-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .suggestions { margin: 0; }
  .agent-search { display: grid; gap: var(--space-1); font-weight: 600; }
  .agent-results { display: grid; gap: var(--space-1); }
  .agent-result { width: 100%; padding: var(--space-2); text-align: left; }
  @media (max-width: 520px) { .decision-actions > button { width: 100%; } }
</style>
