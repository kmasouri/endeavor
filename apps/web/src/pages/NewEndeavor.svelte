<script lang="ts">
  import { api, type Conversation, type DirectoryEntry, type Human } from '../api';
  import { createAction, createLoad } from '../state.svelte';
  import Modal from '../Modal.svelte';
  import Avatar from '../Avatar.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  let { people, me, onCreated, onClose }: {
    people: Human[];
    me: Human;
    onCreated: (conversation: Conversation) => void;
    onClose: () => void;
  } = $props();
  const directory = createLoad(() => api.get<DirectoryEntry[]>('/directory'), () => []);
  const action = createAction();
  let title = $state('');
  let query = $state('');
  let selected = $state<string[]>([]);
  let choices = $derived([
    ...people.filter((person) => person.id !== me.id).map((person) => ({ ...person, type: 'human', purpose: 'Person' })),
    ...(directory.data ?? []).map((agent) => ({ ...agent, type: 'agent' }))
  ]);
  let filtered = $derived(choices.filter((member) =>
    `${member.name} ${member.purpose}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const toggle = (key: string) => {
    selected = selected.includes(key) ? selected.filter((value) => value !== key) : [...selected, key];
  };
  const start = (event: SubmitEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void action.run(async () => {
      const created = await api.post<Conversation>('/conversations', {
        title: title.trim(),
        agentIds: choices.filter((m) => m.type === 'agent' && selected.includes(`agent:${m.id}`)).map((m) => m.id),
        humanIds: choices.filter((m) => m.type === 'human' && selected.includes(`human:${m.id}`)).map((m) => m.id)
      });
      onCreated(created);
    });
  };
</script>

<Modal title="What do you want to accomplish?" busy={action.busy} {onClose}>
  <form onsubmit={start} class="stack endeavor-form">
    <label>Name<input bind:value={title} required maxlength="200" placeholder="e.g. Explain heat pumps in cold weather" disabled={action.busy} /></label>
    <fieldset disabled={action.busy}>
      <legend>People and agents <span class="muted">(optional)</span></legend>
      <p class="caption muted">You can add members later. Agents respond when you mention them.</p>
      {#if selected.length}<p class="caption">{selected.length} selected</p>{/if}
      <label class="member-search">Find people or agents<input type="search" bind:value={query} placeholder="Search by name or purpose…" /></label>
      <div class="endeavor-members">
        {#each filtered as member (`${member.type}:${member.id}`)}
          <label class="check endeavor-member">
            <Avatar name={member.name} id={member.id} agent={member.type === 'agent'} />
            <span class="grow"><span class="row"><strong>{member.name}</strong>{#if member.type === 'agent'}<span class="agent-label">agent</span>{/if}</span><span class="caption muted">{member.purpose}</span></span>
            <input type="checkbox" aria-label={`Add ${member.name}`} checked={selected.includes(`${member.type}:${member.id}`)} onchange={() => toggle(`${member.type}:${member.id}`)} />
          </label>
        {/each}
        {#if !filtered.length}<p class="caption muted">{directory.data ? 'No matching people or agents.' : 'Loading agents…'}</p>{/if}
      </div>
      <ErrorNote error={directory.error} />
      {#if directory.error}<button type="button" class="secondary" onclick={directory.reload}>Retry loading agents</button>{/if}
    </fieldset>
    <ErrorNote error={action.error} />
    <footer class="dialog-footer">
      <button type="button" class="secondary" disabled={action.busy} onclick={onClose}>Cancel</button>
      <button disabled={action.busy || !title.trim()}>{action.busy ? 'Starting…' : 'Start'}</button>
    </footer>
  </form>
</Modal>
