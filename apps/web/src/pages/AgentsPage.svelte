<script lang="ts">
  import Avatar from '../Avatar.svelte';
  import PageHeader from '../PageHeader.svelte';
  import { type Agent, api, type CostReport } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { go, createLoad } from '../state.svelte';
  import { loadAll } from './agent-data';
  import AgentStatus from './AgentStatus.svelte';
  import './agents.css';
  const agents = createLoad(
    () => loadAll<Agent>('/agents?includeDisabled=true'),
    () => []
  );
  const spending = createLoad(
    async () =>
      new Map(
        await Promise.all(
          (agents.data ?? []).map(
            async (a) => [a.id, await api.get<CostReport>(`/agents/${a.id}/costs`)] as const
          )
        )
      ),
    () => [agents.data],
    15000
  );
  let filter = $state('All');
  let search = $state('');
  let shown = $derived(
    (agents.data ?? []).filter(
      (a) =>
        (filter === 'All' || (filter === 'Disabled' ? !!a.disabledAt : !a.disabledAt)) &&
        a.name.toLowerCase().includes(search.toLowerCase().trim())
    )
  );
</script>

<div class="agents-page">
  <PageHeader
    title="Agents"
    subtitle="Participants you configure to do work in endeavors. No agent is in charge of another."
  >
    {#snippet actions()}{#if agents.data?.length}<button onclick={() => go('/agents/new')}
          >+ Create agent</button
        >{/if}{/snippet}
  </PageHeader>
  <ErrorNote error={agents.error} />
  {#if !agents.data && !agents.error}<p class="muted">Loading agents…</p>
  {:else if agents.data?.length === 0}
    <section class="agent-empty" aria-label="No agents yet">
      <h2>No agents yet</h2>
      <p>
        An agent has a purpose, instructions, and a model. Add it to an endeavor and @mention it to
        give it work.
      </p>
      <button onclick={() => go('/agents/new')}>+ Create agent</button>
      <div class="agent-examples">
        <a href="#/agents/new?example=researcher"
          ><h3>Researcher</h3>
          <p>Finds and summarizes sources on a question, citing each claim.</p></a
        >
        <a href="#/agents/new?example=qa"
          ><h3>QA</h3>
          <p>Tests the staging site and reports failures with steps to reproduce.</p></a
        >
      </div>
      <p class="caption">
        Examples fill in the form. They aren’t built-in roles; you can change everything.
      </p>
    </section>
  {:else if agents.data}
    <div class="agent-toolbar">
      <div class="agent-filters" aria-label="Filter agents">
        {#each ['All', 'Enabled', 'Disabled'] as value (value)}<button
            aria-pressed={filter === value}
            onclick={() => (filter = value)}>{value}</button
          >{/each}
      </div>
      <input
        type="search"
        aria-label="Search agents"
        placeholder="Search agents"
        bind:value={search}
      />
    </div>
    <div class="label muted">Agents · {shown.length}</div>
    <ErrorNote error={spending.error} />
    <ul class="agent-list" aria-label="Agents">
      {#each shown as agent (agent.id)}
        {@const costs = spending.data?.get(agent.id)}
        <li>
          <a class="agent-row" href={`#/agents/${agent.id}`}
            ><Avatar name={agent.name} id={agent.id} agent />
            <div>
              <h3>{agent.name} <span class="agent-label">agent</span></h3>
              <p class="agent-purpose">{agent.purpose}</p>
            </div>
            <div class="agent-model caption">
              {agent.currentVersion?.provider} · {agent.currentVersion?.model}<small
                >Version {agent.currentVersion?.version ?? '—'}</small
              >
            </div>
            <div class="agent-spend caption">
              {#if costs}${costs.thisMonth.costUsd.toFixed(2)}
                <small
                  >{costs.budgetUsd === null
                    ? 'no budget'
                    : `of $${costs.budgetUsd.toFixed(2)}`}</small
                >{#if costs.budgetUsd}<progress
                    aria-label={`${agent.name} monthly spending`}
                    value={costs.thisMonth.costUsd}
                    max={costs.budgetUsd}
                  ></progress>{/if}{:else}<span class="muted"
                  >Spending {spending.error ? 'unavailable' : 'loading…'}</span
                >{/if}
            </div>
            <AgentStatus {agent} /><span class="chevron" aria-hidden="true">›</span></a
          >
        </li>
      {/each}
    </ul>
    {#if !shown.length}<p class="muted">No agents match your search.</p>{/if}
    <p class="caption muted">
      Spending is this month (UTC). Needs setup means the provider has no API key, so its tasks
      can’t run yet.
    </p>
  {/if}
</div>
