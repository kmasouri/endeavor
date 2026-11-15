<script lang="ts">
  import { tick } from 'svelte';
  import { type Agent, type Connection } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import PageHeader from '../PageHeader.svelte';
  import { createAction, createLoad } from '../state.svelte';
  import { readPluginPackage, type PluginPackage } from '../plugin-package';
  import { loadAll } from './agent-data';
  import CatalogNavigation from './CatalogNavigation.svelte';
  import PluginConnection from './PluginConnection.svelte';
  import PluginSkill from './PluginSkill.svelte';
  import './creation.css';

  let bundle = $state<PluginPackage>();
  let configured = $state(false);
  let agentId = $state('');
  let previewHeading: HTMLHeadingElement | undefined = $state();
  const action = createAction();
  const connections = createLoad(() => loadAll<Connection>('/connections'), () => []);
  const agents = createLoad(() => loadAll<Agent>('/agents'), () => []);
  const existingMcp = $derived(connections.data?.filter((connection) => connection.kind === 'mcp' && !connection.disabledAt));

  const preview = (event: Event & { currentTarget: HTMLInputElement }) => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (!files.length) return;
    void action.run(async () => {
      bundle = undefined;
      configured = false;
      agentId = '';
      bundle = await readPluginPackage(files);
      await tick();
      previewHeading?.focus();
    });
  };
</script>

<div class="creation-page">
  <PageHeader title="Plugins" subtitle="Import skills and remote MCP connections from a local plugin folder." />
  <CatalogNavigation current="plugins" />

  <div class="creation-form plugin-import">
    <section class="panel stack">
      <label>
        Plugin folder
        <input type="file" webkitdirectory onclick={(event) => (event.currentTarget.value = '')} disabled={action.busy} onchange={preview} />
      </label>
      <p class="caption muted">Choose the extracted folder that contains the plugin manifest.</p>
      <ErrorNote error={action.error} />
    </section>

    {#if bundle}
      {#key bundle}
        <section class="stack" aria-label="Package preview">
          <h2 bind:this={previewHeading} tabindex="-1">{bundle.name}</h2>
          <p class="caption muted">{bundle.format}{bundle.version ? ` · ${bundle.version}` : ''}</p>
          {#if bundle.description}<p>{bundle.description}</p>{/if}

          {#if bundle.notices.length}
            <section class="panel stack">
              <h3>Skipped components</h3>
              <ul>
                {#each bundle.notices as notice (notice)}<li>{notice}</li>{/each}
              </ul>
            </section>
          {/if}

          {#if bundle.skills.length}
            <h3>Skills</h3>
            {#each bundle.skills as skill (skill.path)}
              <PluginSkill {skill} onDone={() => (configured = true)} />
            {/each}
          {/if}

          {#if bundle.servers.length}
            <h3>Remote MCP servers</h3>
            <ErrorNote error={connections.error} />
            {#each bundle.servers as server (server.name)}
              <PluginConnection {server} connections={existingMcp} onDone={() => {
                configured = true;
                void connections.reload();
              }} />
            {/each}
          {/if}

          {#if !bundle.skills.length && !bundle.servers.length}
            <p>This package has no importable skills or remote MCP servers.</p>
          {/if}

          {#if configured}
            <section class="panel stack" aria-label="Agent access">
              <h3>Agent access</h3>
              <p>To give an agent access, open its configuration and select the skills and connections it needs.</p>
              <ErrorNote error={agents.error} />
              <label>
                Agent
                <select bind:value={agentId}>
                  <option value="">Choose an agent</option>
                  {#each agents.data ?? [] as agent (agent.id)}
                    <option value={agent.id}>{agent.name}</option>
                  {/each}
                </select>
              </label>
              {#if agentId}
                <a href={`#/agents/${agentId}?tab=configuration`}>Open agent configuration</a>
              {:else if agents.data?.length === 0}
                <a href="#/agents/new">Create an agent</a>
              {/if}
            </section>
          {/if}
        </section>
      {/key}
    {/if}
  </div>
</div>

<style>
  .plugin-import :global(.panel) {
    margin: 0;
  }

  .plugin-import :global(.stack > :is(h2, h3, p, ul)) {
    margin-block: 0;
  }

  .plugin-import :global(.stack > h2) {
    font-size: 18px;
    font-weight: 600;
  }

  .plugin-import :global(.stack > h3) {
    font-weight: 600;
  }

  input[type='file'] {
    min-width: 0;
  }
</style>
