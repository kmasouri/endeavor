<script lang="ts">
  import { api, type Conversation, type DirectoryEntry, type Human } from '../api';
  import { createAction, createLoad } from '../state.svelte';
  import Modal from '../Modal.svelte';
  import { canonicalConversationName, conversationNameInput } from '../appearance';
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
    const name = canonicalConversationName(title);
    if (!name) return;
    void action.run(async () => {
      const created = await api.post<Conversation>('/conversations', {
        title: name,
        agentIds: choices.filter((choice) => choice.type === 'agent' && selected.includes(`agent:${choice.id}`)).map((choice) => choice.id),
        humanIds: choices.filter((choice) => choice.type === 'human' && selected.includes(`human:${choice.id}`)).map((choice) => choice.id)
      });
      onCreated(created);
    });
  };
</script>

<Modal title="What do you want to accomplish?" busy={action.busy} {onClose}>
  <form onsubmit={start} class="stack endeavor-form">
    <div class="channel-name"><label for="new-endeavor-name">Name</label><span class="channel-name-field"><span aria-hidden="true">#</span><input
      id="new-endeavor-name"
      value={title}
      required
      maxlength="200"
      pattern="[a-z0-9]+(-[a-z0-9]+)*-?"
      placeholder="e.g. explain-heat-pumps"
      aria-describedby="channel-name-hint"
      autocapitalize="none"
      spellcheck={false}
      disabled={action.busy}
      oninput={(event) => {
        const input = event.currentTarget;
        const cursor = conversationNameInput(input.value.slice(0, input.selectionStart ?? input.value.length)).length;
        title = conversationNameInput(input.value);
        input.value = title;
        input.setSelectionRange(cursor, cursor);
      }}
      onblur={() => (title = canonicalConversationName(title))}
    /></span></div>
    <p id="channel-name-hint" class="caption muted">Lowercase letters, numbers, and hyphens. Spaces become hyphens.</p>
    <fieldset disabled={action.busy}>
      <legend>People and agents <span class="muted">(optional)</span></legend>
      <p class="caption muted">You can add members later. Agents respond when you mention them.</p>
      {#if selected.length}<p class="caption">{selected.length} selected</p>{/if}
      <label class="member-search">Find people or agents<input type="search" bind:value={query} placeholder="Search by name or purpose…" /></label>
      <div class="endeavor-members">
        {#each filtered as member (`${member.type}:${member.id}`)}
          <label class="check endeavor-member">
            <Avatar name={member.name} id={member.id} agent={member.type === 'agent'} />
            <span class="grow"><span class="row"><strong>{member.name}</strong></span><span class="caption muted">{member.purpose}</span></span>
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
      <button disabled={action.busy || !canonicalConversationName(title)}>{action.busy ? 'Starting…' : 'Start'}</button>
    </footer>
  </form>
</Modal>
