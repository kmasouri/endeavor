<script lang="ts">
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

<div class="columns">
  <section>
    <h1>Agents</h1>

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
            <strong>
              {agent.name}
            </strong>
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

  <aside class="panel">
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
