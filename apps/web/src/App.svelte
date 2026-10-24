<script lang="ts">
  import {
    api,
    getActorId,
    type Human,
    setActorId,
    type Approval,
    type Responsibility
  } from './api';
  import ErrorNote from './ErrorNote.svelte';
  import { createLoad } from './state.svelte';
  import AgentPage from './pages/AgentPage.svelte';
  import ApprovalsPage from './pages/ApprovalsPage.svelte';
  import SchedulesPage from './pages/SchedulesPage.svelte';
  import TaskPage from './pages/TaskPage.svelte';
  import TasksPage from './pages/TasksPage.svelte';
  import AgentsPage from './pages/AgentsPage.svelte';
  import CatalogsPage from './pages/CatalogsPage.svelte';
  import ConversationPage from './pages/ConversationPage.svelte';
  import ConversationsPage from './pages/ConversationsPage.svelte';
  import SetupPage from './pages/SetupPage.svelte';
  import FirstPerson from './FirstPerson.svelte';
  import PickPerson from './PickPerson.svelte';

  let actorId = $state(getActorId());
  const people = createLoad(
    () => api.get<Human[]>('/humans'),
    () => []
  );
  let hash = $state(window.location.hash);
  let route = $derived(hash.replace(/^#\/?/, '').split('/').filter(Boolean));
  const schedules = createLoad(
    () =>
      actorId
        ? api.list<Responsibility>('/responsibilities?status=enabled&limit=100')
        : Promise.resolve(undefined),
    () => [actorId],
    15000
  );
  let catchUps = $derived((schedules.data?.data ?? []).filter((s) => s.catchUp).length);
  const pending = createLoad(
    () =>
      actorId
        ? api.list<Approval>('/approvals?status=pending&limit=1')
        : Promise.resolve(undefined),
    () => [actorId],
    10000
  );
  const choose = (id: string | null) => {
    setActorId(id);
    actorId = id;
  };
  let me = $derived(people.data?.find((person) => person.id === actorId));
  let [section, id] = $derived(route);
</script>

<svelte:window
  onhashchange={() => {
    hash = window.location.hash;
  }}
/>

{#if people.error}
  <main class="narrow">
    <h1>Collaborative Agents</h1>

    <ErrorNote error={`Can't reach the platform: ${people.error}`} />

    <p>Check that it's running (`npm run up`), then reload.</p>
  </main>
{:else if !people.data}
  <main class="narrow">Loading…</main>
{:else if people.data.length === 0}
  <FirstPerson onCreated={(human) => (choose(human.id), people.reload())} />
{:else if !me}
  <PickPerson people={people.data} onPick={choose} />
{:else}
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#/"> Collaborative Agents </a>

      <nav>
        <a class={!section || section === 'conversations' ? 'active' : ''} href="#/">
          Conversations
        </a>

        <a class={section === 'tasks' ? 'active' : ''} href="#/tasks"> Work </a>

        <a class={section === 'approvals' ? 'active' : ''} href="#/approvals">
          Approvals

          {#if pending.data && pending.data.page.total > 0}
            {` (${pending.data.page.total})`}
          {/if}
        </a>

        <a class={section === 'schedules' ? 'active' : ''} href="#/schedules">
          Schedules

          {#if catchUps > 0}
            {` (${catchUps})`}
          {/if}
        </a>

        <a class={section === 'agents' ? 'active' : ''} href="#/agents"> Agents </a>

        <a class={section === 'catalogs' ? 'active' : ''} href="#/catalogs">
          Skills and connections
        </a>

        <a class={section === 'setup' ? 'active' : ''} href="#/setup"> Setup </a>
      </nav>

      <label class="acting-as">
        Acting as

        <select value={me.id} onchange={(event) => choose(event.currentTarget.value)}>
          {#each people.data ?? [] as person (person.id)}
            <option value={person.id}>
              {person.name}
            </option>
          {/each}
        </select>
      </label>
    </header>

    <main>
      {#key `${actorId}:${route.join('/')}`}
        {#if section === 'setup'}
          <SetupPage people={people.data} onPeopleChanged={people.reload} />
        {:else if section === 'tasks' && id}
          <TaskPage taskId={id} />
        {:else if section === 'tasks'}
          <TasksPage />
        {:else if section === 'approvals'}
          <ApprovalsPage />
        {:else if section === 'schedules'}
          <SchedulesPage />
        {:else if section === 'agents' && id}
          <AgentPage agentId={id} />
        {:else if section === 'agents'}
          <AgentsPage />
        {:else if section === 'catalogs'}
          <CatalogsPage />
        {:else if section === 'conversations' && id}
          <ConversationPage conversationId={id} {me} />
        {:else}
          <ConversationsPage />
        {/if}
      {/key}
    </main>
  </div>
{/if}
