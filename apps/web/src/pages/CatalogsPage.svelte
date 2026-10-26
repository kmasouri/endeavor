<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../Icon.svelte';
  import ManagementToolbar from '../ManagementToolbar.svelte';
  import { type Connection, type Skill } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createLoad, go } from '../state.svelte';
  import { loadAll } from './agent-data';
  import './creation.css';
  let { kind }: { kind: 'skills' | 'connections' } = $props();
  const entries = createLoad<(Skill | Connection)[]>(() => kind === 'skills' ? loadAll<Skill>('/skills') : loadAll<Connection>('/connections'), () => [kind]);
  const title = $derived(kind === 'skills' ? 'Skills' : 'Connections');
  const singular = $derived(kind === 'skills' ? 'skill' : 'connection');
  let filter = $state('All');
  let search = $state('');
  const shown = $derived((entries.data ?? []).filter((entry) =>
    (filter === 'All' || (filter === 'Disabled' ? !!entry.disabledAt : !entry.disabledAt)) &&
    `${entry.name} ${entry.description} ${'baseUrl' in entry ? entry.baseUrl : ''}`.toLowerCase().includes(search.trim().toLowerCase())
  ));
</script>
<div class="creation-page">
  <PageHeader {title} subtitle={kind === 'skills' ? 'Reusable instructions for your agents.' : 'HTTP APIs and MCP servers your agents can use.'}>
    {#snippet actions()}<button onclick={() => go(`/${kind}/new`)}>+ Create {singular}</button>{/snippet}
  </PageHeader>
  <ErrorNote error={entries.error} />
  {#if !entries.data && !entries.error}<p class="muted">Loading {kind}…</p>{/if}
  {#if entries.data}
    <ManagementToolbar name={kind} filters={['All', 'Enabled', 'Disabled']} bind:filter bind:search />
    <div class="label muted">{title} · {shown.length}</div>
    <ul class="management-list" aria-label={title}>
      {#each shown as entry (entry.id)}
        <li><a class="management-row" href={`#/${kind}/${entry.id}`}>
          <span class="management-icon"><Icon name={kind === 'skills' ? 'file' : 'connections'} /></span>
          <div><h3>{entry.name}</h3><p>{entry.description}</p></div>
          <div class="management-meta">
            {#if 'baseUrl' in entry}
              {entry.kind === 'mcp' ? 'MCP server' : 'HTTP API'}
              <small>{entry.hasCredential ? 'Credential saved' : 'No credential'}</small>
            {:else}Versioned instructions{/if}
          </div>
          <span class="management-status" class:enabled={!entry.disabledAt}>{entry.disabledAt ? 'Disabled' : 'Enabled'}</span>
          <span class="chevron" aria-hidden="true">›</span>
        </a></li>
      {/each}
    </ul>
    {#if !entries.data.length}
      <section class="management-empty"><h2>No {kind} yet</h2><p>Create a {singular} to make it available in agent configuration.</p></section>
    {:else if !shown.length}<p class="muted">No {kind} match your filters.</p>{/if}
    <p class="caption muted">{kind === 'skills' ? 'Skills provide instructions. Choose connection access separately on each agent.' : 'Adding a connection grants no access. Choose it on each agent to allow its use.'}</p>
  {/if}
</div>
