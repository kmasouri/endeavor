<script lang="ts">
  import {
    api,
    getActorId,
    type Human,
    setActorId,
    type Approval,
    type Conversation,
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
  import NewEndeavor from './pages/NewEndeavor.svelte';
  import SearchEndeavors from './pages/SearchEndeavors.svelte';
  import { loadEndeavors, lastEndeavor, rememberEndeavor } from './endeavors';
  import SetupPage from './pages/SetupPage.svelte';
  import FirstPerson from './FirstPerson.svelte';
  import PickPerson from './PickPerson.svelte';
  import SwitchPerson from './SwitchPerson.svelte';

  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import { timeDisplay } from './time-display.svelte';
  import { applyTheme, conversationChannelName } from './appearance';

  let guard = $state<() => boolean>(() => true);
  let dirty = $state(false);
  let savedPerson = $state<Human | null>(null);
  let collapsed = $state(window.innerWidth < 700);
  let picking = $state(false);
  let switching = $state(false);
  let creating = $state(false);
  let searching = $state(false);
  let focusConversation = $state<string | null>(null);
  let additions = $state<Conversation[]>([]);
  let switchError = $state<string | null>(null);
  let actorId = $state(getActorId());
  const people = createLoad(
    () => api.get<Human[]>('/humans'),
    () => []
  );
  let hash = $state(window.location.hash);
  let route = $derived(hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean));
  const schedules = createLoad(
    () =>
      actorId
        ? api.list<Responsibility>('/responsibilities?status=enabled&limit=100')
        : Promise.resolve(undefined),
    () => [actorId],
    15000
  );
  const conversations = createLoad(
    () =>
      actorId ? loadEndeavors() : Promise.resolve(undefined),
    () => [actorId],
    10000
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
  const choose = async (id: string | null) => {
    if (id === actorId || switching || !guard()) return;
    switching = true;
    switchError = null;
    try {
      // Refresh before mounting the person's editor, including changes from another browser.
      const current = await api.get<Human[]>('/humans');
      const person = current.find((person) => person.id === id);
      if (!person) throw new Error('This person is no longer available. Reload and choose again.');
      dirty = false;
      guard = () => true;
      creating = false;
      searching = false;
      additions = [];
      focusConversation = null;
      savedPerson = person;
      setActorId(id);
      actorId = id;
      picking = false;
      if (window.innerWidth < 700) collapsed = true;
      people.reload();
    } catch (caught) {
      switchError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      switching = false;
    }
  };
  let me = $derived(
    savedPerson?.id === actorId ? savedPerson : people.data?.find((person) => person.id === actorId)
  );
  $effect(() => {
    const theme = me?.preferences.theme;
    if (!theme) return;
    applyTheme(theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      if (theme === 'system') applyTheme(theme);
    };
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  });
  $effect(() => {
    timeDisplay.format = me?.preferences.timeFormat ?? '12h';
  });
  let [section, id] = $derived(route);
  let recent = $derived([...new Map([...additions, ...(conversations.data ?? [])].map((c) => [c.id, c])).values()]);
  $effect(() => {
    if (!actorId || !conversations.data || (section && section !== 'conversations') || id) return;
    const saved = lastEndeavor(actorId);
    const selected = recent.find((c) => c.id === saved) ?? recent[0];
    if (selected) window.location.hash = `/conversations/${selected.id}`;
  });
  const openConversation = (id: string) => {
    searching = false;
    window.location.hash = `/conversations/${id}`;
    if (window.innerWidth < 700) collapsed = true;
  };
  const newEndeavor = () => { if (guard()) creating = true; };
  const searchEndeavors = () => {
    if (!creating && !picking && !searching && guard()) searching = true;
  };
  const created = (conversation: Conversation) => {
    additions = [conversation, ...additions];
    focusConversation = conversation.id;
    creating = false;
    rememberEndeavor(actorId!, conversation.id);
    openConversation(conversation.id);
    conversations.reload();
  };
</script>

<svelte:window
  onkeydown={(event) => {
    if (me && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchEndeavors();
    }
  }}
  onbeforeunload={(event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  }}
  onhashchange={() => {
    if (window.location.hash === hash) return;
    if (!guard()) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search + hash
      );
      return;
    }
    dirty = false;
    guard = () => true;
    hash = window.location.hash;
  }}
/>

{#if people.error}
  <main class="narrow">
    <h1>Endeavor</h1>

    <ErrorNote error={`Can't reach the platform: ${people.error}`} />

    <p>Check that it's running (`npm run up`), then reload.</p>
  </main>
{:else if !people.data}
  <main class="narrow">Loading…</main>
{:else if people.data.length === 0}
  <FirstPerson onCreated={(human) => (choose(human.id), people.reload())} />
{:else if !me}
  <PickPerson people={people.data} onPick={choose} />
  <ErrorNote error={switchError} />
{:else}
  <div class="shell" class:sidebar-collapsed={collapsed}>
    <header class="app-bar">
      <div class="row app-brand">
        <button class="quiet icon-button" aria-label={collapsed ? 'Open sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-controls="main-sidebar" onclick={() => (collapsed = !collapsed)}><Icon name="panel" /></button>
        <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">E</span>Endeavor</a>
      </div>
      <button class="secondary search-launch" aria-label="Search endeavors" onclick={searchEndeavors}><Icon name="search" /><span>Search endeavors…</span><kbd>⌘ / Ctrl K</kbd></button>
    </header>
    <aside class="sidebar" id="main-sidebar" aria-label="Sidebar">
      <nav aria-label="Main">
        {#each [['', 'Endeavors', 'conversations'], ['approvals', 'Approvals', 'approvals'], ['schedules', 'Schedules', 'schedules'], ['agents', 'Agents', 'agents'], ['catalogs', 'Skills and connections', 'catalogs'], ['setup', 'Setup', 'setup'], ['tasks', 'Work', 'work']] as [path, label, icon] (path)}
          <a
            class:active={path === ''
              ? !section || section === 'conversations'
              : section === path}
            href={`#/${path}`}
            aria-label={label}
            title={label}
            aria-current={(path === '' ? !section || section === 'conversations' : section === path) ? 'page' : undefined}
            onclick={() => {
              if (window.innerWidth < 700) collapsed = true;
            }}
          >
            <Icon name={icon} /><span class="grow sidebar-label">{label}</span>
            {#if path === 'approvals' && pending.data?.page.total}<span class="count-badge"
                >{pending.data.page.total}</span
              >{/if}
            {#if path === 'schedules' && catchUps}<span class="count-badge">{catchUps}</span>{/if}
          </a>
        {/each}
      </nav>
      {#if !section || section === 'conversations'}
        <div class="sidebar-conversations">
          <div class="row">
            <span class="label grow">Recent</span><button class="quiet new-endeavor" aria-label="New endeavor" onclick={newEndeavor}><Icon name="plus" size={14} /> New</button>
          </div>
          <ErrorNote error={conversations.error} />
          {#each recent as conversation (conversation.id)}
            <a
              class:active={section === 'conversations' && id === conversation.id}
              href={`#/conversations/${conversation.id}`}
              title={conversation.title}
              aria-current={section === 'conversations' && id === conversation.id ? 'page' : undefined}
              onclick={() => {
                if (window.innerWidth < 700) collapsed = true;
              }}
              ><span class="ellipsis">{conversationChannelName(conversation.title)}</span></a
            >
          {/each}
        </div>
      {/if}
      <div class="sidebar-footer">
        <div class="sidebar-profile">
          <button
            class="quiet row profile-button"
            class:active={section === 'settings'}
            aria-label="Profile and settings"
            onclick={() => {
              window.location.hash = '/settings';
              if (window.innerWidth < 700) collapsed = true;
            }}
            ><Avatar name={me.name} id={me.id} /><span class="sidebar-label"
              ><strong>{me.name}</strong><span class="caption muted">Profile and settings</span
              ></span
            ></button
          >
          <button
            class="quiet switch-person"
            aria-label="Switch person"
            title="Switch person"
            disabled={switching}
            aria-haspopup="dialog"
            aria-expanded={picking}
            onclick={() => {
              switchError = null;
              picking = true;
            }}><Icon name="switch" size={16} /></button
          >
        </div>
      </div>
    </aside>

    <main class:conversation-main={section === 'conversations' && Boolean(id)}>
      {#key `${actorId}:${hash}`}
        {#if section === 'settings'}
          <SettingsPage
            person={me}
            onSaved={(person) => {
              savedPerson = person;
              people.reload();
            }}
            onGuard={(next) => (guard = next)}
            onDirty={(next) => (dirty = next)}
          />
        {:else if section === 'setup'}
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
          <ConversationPage conversationId={id} {me} onReady={(conversation) => {
            rememberEndeavor(actorId!, conversation.id);
            const focus = focusConversation === conversation.id;
            if (focus) focusConversation = null;
            return focus;
          }} />
        {:else}
          <section class="endeavor-empty">
            <Icon name="conversations" size={36} />
            {#if conversations.error}
              <h1>Endeavors</h1><ErrorNote error={conversations.error} /><button class="secondary" onclick={conversations.reload}>Retry</button>
            {:else if !conversations.data || recent.length}
              <p class="muted">Opening your endeavor…</p>
            {:else}
              <h1>What do you want to accomplish?</h1>
              <p class="muted">Start your first endeavor. Bring in people and agents whenever you need them.</p>
              <button aria-label="New endeavor" onclick={newEndeavor}><Icon name="plus" /> New endeavor</button>
            {/if}
          </section>
        {/if}
      {/key}
    </main>
    {#key actorId}
      {#if creating}<NewEndeavor people={people.data} {me} onCreated={created} onClose={() => (creating = false)} />{/if}
      {#if searching}<SearchEndeavors conversations={recent} error={conversations.error} loading={!conversations.data} onPick={openConversation} onClose={() => (searching = false)} onRetry={conversations.reload} />{/if}
    {/key}
    {#if picking}
      <SwitchPerson
        people={people.data}
        currentId={me.id}
        busy={switching}
        error={switchError}
        onPick={choose}
        onClose={() => (picking = false)}
      />
    {/if}
  </div>
{/if}
