<script lang="ts">
  import { api, type Connection, type Skill } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createLoad } from '../state.svelte';
  import SkillRow from './SkillRow.svelte';
  import NewSkill from './NewSkill.svelte';
  import ConnectionRow from './ConnectionRow.svelte';
  import NewConnection from './NewConnection.svelte';
  import './catalogs.css';

  let tab = $state<'skills' | 'connections'>('skills');

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

<div class="catalogs narrow wide">
  <h1>Skills and connections</h1>

  <p class="muted">Reusable instructions and API connections for your agents.</p>

  <nav class="catalog-tabs" aria-label="Catalog">
    <button class:active={tab === 'skills'} aria-current={tab === 'skills' ? 'page' : undefined} onclick={() => (tab = 'skills')}>Skills</button>
    <button class:active={tab === 'connections'} aria-current={tab === 'connections' ? 'page' : undefined} onclick={() => (tab = 'connections')}>Connections</button>
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

    <NewSkill onCreated={skills.reload} />
  </section>

  {:else}
  <section class="panel">
    <h2>Connections</h2>

    <Hint>
      A connection is an outside API agents can call. The platform adds the credential and checks
      every call's method and path. Credentials are stored encrypted and never shown again.
    </Hint>

    <ErrorNote error={connections.error} />

    <ul class="list">
      {#each connectionList ?? [] as connection (connection.id)}
        <ConnectionRow {connection} onChanged={connections.reload} />
      {/each}
    </ul>

    <NewConnection onCreated={connections.reload} />
  </section>
  {/if}
</div>
