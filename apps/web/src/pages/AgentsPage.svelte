<script lang="ts">
  import Avatar from '../Avatar.svelte';
  import PageHeader from '../PageHeader.svelte';
  import { type Agent, api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { go, createAction, createLoad } from '../state.svelte';
  import AgentConfigFields from './AgentConfigFields.svelte';
  import { type ConfigValues, initialConfig } from './AgentConfig';

  const agents = createLoad(
    () => api.list<Agent>('/agents?includeDisabled=true&limit=100'),
    () => []
  );
  let name = $state('');
  let purpose = $state('');
  let config = $state<ConfigValues>(initialConfig());
  const action = createAction();
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const agent = await api.post<Agent>('/agents', { name, purpose, ...config });
      go(`/agents/${agent.id}`);
    });
  };
</script>

<PageHeader title="Agents" subtitle="Configure the people-like participants that do your work.">
  {#snippet actions()}<button
      onclick={() =>
        document
          .getElementById('new-agent')
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>New agent</button
    >{/snippet}
</PageHeader>

<div class="columns">
  <section>
    <Hint>
      An agent is a configured participant. A QA agent and a research agent are the same kind of
      thing with different settings, and no agent is in charge of another.
    </Hint>

    <ErrorNote error={agents.error} />

    {#if agents.data?.data.length === 0}
      <p class="muted">No agents yet.</p>
    {/if}

    <ul class="list">
      {#each agents.data?.data ?? [] as agent (agent.id)}
        <li>
          <a href={`#/agents/${agent.id}`}>
            <span class="row"
              ><Avatar name={agent.name} id={agent.id} agent /><strong>{agent.name}</strong><span
                class="agent-label">agent</span
              ></span
            >
          </a>

          {#if agent.disabledAt}
            <span class="badge"> disabled </span>
          {/if}

          {#if !agent.providerReady}
            <span class="badge warn"> provider not set up </span>
          {/if}

          <div class="muted small">
            {agent.purpose}

            {#if agent.currentVersion}
              {` · ${agent.currentVersion.provider} ${agent.currentVersion.model} · version ${agent.currentVersion.version}`}
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <aside class="panel" id="new-agent">
    <h2>New agent</h2>

    <form onsubmit={create} class="stack">
      <label>
        Name

        <input bind:value={name} required />
      </label>

      <label>
        Purpose

        <Hint>One line other participants see in the directory.</Hint>

        <input bind:value={purpose} required />
      </label>

      <AgentConfigFields onChange={(value) => (config = value)} />

      <button disabled={action.busy || !name.trim() || !config.instructions.trim()}>
        Create agent
      </button>

      <ErrorNote error={action.error} />
    </form>
  </aside>
</div>
