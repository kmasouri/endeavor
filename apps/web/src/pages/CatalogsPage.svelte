<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import { api, type Connection, type Skill } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createLoad, go } from '../state.svelte';
  import SkillRow from './SkillRow.svelte';
  import ConnectionRow from './ConnectionRow.svelte';
  import './catalogs.css';

  const tab = $state<'skills' | 'connections'>(
    new URLSearchParams(window.location.hash.split('?')[1]).get('tab') === 'connections'
      ? 'connections'
      : 'skills'
  );

  const skills = createLoad(
    () => api.list<Skill>('/skills?limit=100'),
    () => []
  );
  const connections = createLoad(
    () => api.list<Connection>('/connections?limit=100'),
    () => []
  );
  let connectionList = $derived(connections.data?.data ?? []);
</script>

<PageHeader
  title="Skills and connections"
  subtitle="Reusable instructions and connections for your agents."
>
  {#snippet actions()}
    <button onclick={() => go(`/catalogs/${tab}/new`)}>
      New {tab === 'skills' ? 'skill' : 'connection'}
    </button>
  {/snippet}
</PageHeader>

<div class="catalogs narrow wide">
  <nav class="catalog-tabs" aria-label="Catalog">
    <button
      class:active={tab === 'skills'}
      aria-current={tab === 'skills' ? 'page' : undefined}
      onclick={() => go('/catalogs?tab=skills')}>Skills</button
    >
    <button
      class:active={tab === 'connections'}
      aria-current={tab === 'connections' ? 'page' : undefined}
      onclick={() => go('/catalogs?tab=connections')}>Connections</button
    >
  </nav>

  {#if tab === 'skills'}
    <section class="panel">
      <h2>Skills</h2>

      <Hint>
        Skills are reusable instructions only. Choose skills and connection access independently on
        each agent. Editing a skill saves a new version and never changes API access.
      </Hint>

      <ErrorNote error={skills.error} />

      <ul class="list">
        {#each skills.data?.data ?? [] as skill (skill.id)}
          <SkillRow {skill} onChanged={skills.reload} />
        {/each}
      </ul>
    </section>
  {:else}
    <section class="panel">
      <h2>Connections</h2>

      <Hint>
        A connection gives agents access to an HTTP API or MCP server. The platform adds the
        credential and checks each call against its allowed methods, paths, or tools. Credentials are stored encrypted and never shown again.
      </Hint>

      <ErrorNote error={connections.error} />

      <ul class="list">
        {#each connectionList ?? [] as connection (connection.id)}
          <ConnectionRow {connection} onChanged={connections.reload} />
        {/each}
      </ul>
    </section>
  {/if}
</div>
