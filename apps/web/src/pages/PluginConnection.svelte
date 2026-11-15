<script lang="ts">
  import { type Connection } from '../api';
  import { type PluginServer } from '../plugin-package';
  import NewConnection from './NewConnection.svelte';

  let { server, connections, onDone }: {
    server: PluginServer;
    connections: Connection[] | undefined;
    onDone: () => void;
  } = $props();
  let picked = $state('');
  let configuring = $state(false);
  let resolved = $state<Connection>();
  let selected = $derived(connections?.find((entry) => entry.id === picked));
  const finish = (connection: Connection) => {
    resolved = connection;
    configuring = false;
    onDone();
  };
</script>

<section class="panel stack" aria-label={server.name}>
  <h3>{server.name}</h3>
  <p class="muted">{server.url}</p>
  {#if resolved}
    <p role="status">Using <a href={`#/connections/${resolved.id}`}>{resolved.name}</a>.</p>
    {#if resolved.authMethod === 'oauth' && !resolved.hasCredential}
      <a href={`#/connections/${resolved.id}?signIn=1`}>Connect {resolved.name} with OAuth</a>
    {/if}
  {:else if configuring}
    <NewConnection imported={server} onCreated={finish} onCancel={() => (configuring = false)} />
  {:else}
    <label>
      Existing MCP connection
      <select bind:value={picked} disabled={!connections}>
        <option value="">Choose a connection</option>
        {#each connections ?? [] as connection (connection.id)}
          <option value={connection.id}>{connection.name} · {connection.baseUrl}</option>
        {/each}
      </select>
    </label>
    <div class="row wrap">
      <button class="secondary" disabled={!selected} onclick={() => selected && finish(selected)}>Use selected connection</button>
      <button class="secondary" onclick={() => (configuring = true)}>Configure new connection</button>
    </div>
  {/if}
</section>
