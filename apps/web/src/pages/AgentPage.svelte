<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import { type Agent, type AgentVersion, api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { when } from '../components';
  import { createLoad } from '../state.svelte';
  import SavedNotes from './SavedNotes.svelte';
  import Spending from './Spending.svelte';
  import Profile from './Profile.svelte';
  import NewVersion from './NewVersion.svelte';
  import EnableToggle from './EnableToggle.svelte';
  import Grants from './Grants.svelte';

  let {
    agentId
  }: {
    agentId: string;
  } = $props();
  const agent = createLoad(
    () => api.get<Agent>(`/agents/${agentId}`),
    () => [agentId]
  );
  const versions = createLoad(
    () => api.get<AgentVersion[]>(`/agents/${agentId}/versions`),
    () => [agentId]
  );
  const reloadAll = () => (agent.reload(), versions.reload());
  let a = $derived(agent.data!);
</script>

{#if agent.error}
  <ErrorNote error={agent.error} />
{:else if !agent.data}
  <p>Loading…</p>
{:else}
  <PageHeader title={a.name} subtitle={a.purpose} />
  <div class="columns">
    <section>
      {#if !a.providerReady}
        <p class="error">
          This agent's provider isn't set up, so its tasks can't run. Add the API key to .env and
          restart.
        </p>
      {/if}

      <Profile agent={a} onSaved={agent.reload} />

      {#key a.currentVersionId ?? 'none'}
        <NewVersion agent={a} onSaved={reloadAll} />
      {/key}

      <div class="panel">
        <SavedNotes agentId={a.id} />
      </div>
    </section>

    <aside>
      <div class="panel">
        <EnableToggle agent={a} onChanged={agent.reload} />
      </div>

      <div class="panel">
        <Spending kind="agent" id={a.id} />
      </div>

      <div class="panel">
        <Grants agentId={a.id} />
      </div>

      <div class="panel">
        <h2>Versions</h2>

        <Hint>
          Each task keeps the version it started with. Moving a task to a newer version is a
          separate, deliberate step.
        </Hint>

        <ul class="list">
          {#each versions.data ?? [] as version (version.id)}
            <li>
              <strong>
                Version {version.version}
              </strong>

              {#if version.id === a.currentVersionId}
                <span class="badge"> current </span>
              {/if}

              <div class="muted small">
                {version.provider}
                {version.model} · {when(version.createdAt)}
              </div>

              {#if version.legacyConnectionIds?.length}
                <p class="error small">
                  This version relied on inherited connections. Calls now require explicit
                  connection selection. Save a reviewed configuration and move open tasks to it.
                </p>
              {/if}

              <details>
                <summary> Instructions </summary>

                <p class="body small">
                  {version.instructions}
                </p>
              </details>
            </li>
          {/each}
        </ul>
      </div>
    </aside>
  </div>
{/if}
