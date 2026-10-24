<script lang="ts">
  import { api, type Connection, type Skill } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createLoad } from '../state.svelte';
  import SkillRow from './SkillRow.svelte';
  import NewSkill from './NewSkill.svelte';
  import ConnectionRow from './ConnectionRow.svelte';
  import NewConnection from './NewConnection.svelte';

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

<div class="narrow wide">
  <h1>Skills and connections</h1>

  <Hint>
    These are shared catalogs. Adding something here gives no agent access: choose it in an agent's
    configuration, or grant it on the agent's page.
  </Hint>

  <section class="panel">
    <h2>Skills</h2>

    <Hint>
      A skill is a named set of instructions plus the connections it may use. Editing one saves a
      new version; agents keep the version they were set up with.
    </Hint>

    <ErrorNote error={skills.error} />

    <ul class="list">
      {#each skills.data?.data ?? [] as skill (skill.id)}
        <SkillRow {skill} connections={connectionList} onChanged={skills.reload} />
      {/each}
    </ul>

    <NewSkill connections={connectionList} onCreated={skills.reload} />
  </section>

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
</div>
