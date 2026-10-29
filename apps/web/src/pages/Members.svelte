<script lang="ts">
  import { api, type DirectoryEntry, type Human, type Member } from '../api';
  import Avatar from '../Avatar.svelte';
  import ParticipantProfile from '../ParticipantProfile.svelte';
  import Modal from '../Modal.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import { formatDateTime } from '../components';
  import { createAction, createLoad } from '../state.svelte';

  let { conversationId, me, members, onChanged, onClose }: {
    conversationId: string;
    me: Human;
    members: Member[];
    onChanged: () => void;
    onClose: () => void;
  } = $props();
  const people = createLoad(() => api.get<Human[]>('/humans'), () => []);
  const directory = createLoad(() => api.get<DirectoryEntry[]>('/directory'), () => []);
  const action = createAction();
  let query = $state('');
  let selected = $state<string[]>([]);
  let added = $state<string[]>([]);
  let hideHistory = $state(false);
  const key = (type: string, id: string) => `${type}:${id}`;
  let inside = $derived(new Set([
    ...members.map((member) => key(member.participant.type, member.participant.id)), ...added
  ]));
  let choices = $derived([
    ...(people.data ?? []).map((person) => ({ ...person, type: 'human', purpose: 'Person', avatarColor: null, avatarIcon: null })),
    ...(directory.data ?? []).map((agent) => ({ ...agent, type: 'agent' }))
  ].filter((person) => !inside.has(key(person.type, person.id))));
  let filtered = $derived(choices.filter((person) =>
    `${person.name} ${person.purpose}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const toggle = (value: string) => {
    selected = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
  };
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    void action.run(async () => {
      for (const person of choices.filter((person) => selected.includes(key(person.type, person.id)))) {
        await api.post(`/conversations/${conversationId}/members`, {
          type: person.type, id: person.id, history: hideHistory ? 'from_now' : 'all'
        });
        const value = key(person.type, person.id);
        added = [...added, value];
        selected = selected.filter((item) => item !== value);
        onChanged();
      }
    });
  };
</script>

<Modal title="People and agents" busy={action.busy} {onClose}>
  <form onsubmit={add} class="stack endeavor-form">
    <section aria-label="Current members">
      <h3 class="label">Members · {members.length}</h3>
      <div class="endeavor-members">
        {#each members as member (`${member.participant.type}:${member.participant.id}`)}
          <div class="row endeavor-member">
            <ParticipantProfile name={member.name} id={member.participant.id} appearance={member} agent={member.participant.type === 'agent'} meId={me.id} {member} directory={directory.data?.find((entry) => entry.id === member.participant.id)} avatar>
              <Avatar name={member.name} id={member.participant.id} appearance={member} agent={member.participant.type === 'agent'} />
            </ParticipantProfile>
            <span class="grow"><span class="row"><ParticipantProfile name={member.name} id={member.participant.id} appearance={member} agent={member.participant.type === 'agent'} meId={me.id} {member} directory={directory.data?.find((entry) => entry.id === member.participant.id)}>
                <strong>{member.name}</strong>
              </ParticipantProfile>
              {#if member.participant.id === me.id}<span class="caption muted">(you)</span>{/if}
            </span>
            {#if member.purpose}<span class="caption muted">{member.purpose}</span>{/if}
            {#if member.historyFrom}<span class="caption muted">Sees messages from {formatDateTime(member.historyFrom)}</span>{/if}
            </span>
          </div>
        {/each}
      </div>
    </section>
    <fieldset disabled={action.busy}>
      <legend>Add people or agents</legend>
      <p class="caption muted">Agents respond when you mention them. Added members can read the history you allow.</p>
      <label class="member-search">Find people or agents<input type="search" bind:value={query} placeholder="Search by name or purpose…" /></label>
      <div class="endeavor-members">
        {#each filtered as person (`${person.type}:${person.id}`)}
          <label class="check endeavor-member">
            <Avatar name={person.name} id={person.id} appearance={person} agent={person.type === 'agent'} />
            <span class="grow"><span class="row"><strong>{person.name}</strong></span><span class="caption muted">{person.purpose}</span></span>
            <input type="checkbox" aria-label={`Add ${person.name}`} checked={selected.includes(key(person.type, person.id))} onchange={() => toggle(key(person.type, person.id))} />
          </label>
        {/each}
        {#if !filtered.length}<p class="caption muted">{people.data && directory.data ? 'No matching people or agents.' : 'Loading people and agents…'}</p>{/if}
      </div>
      <label class="check"><input type="checkbox" bind:checked={hideHistory} />Hide earlier messages from them</label>
      <ErrorNote error={people.error ?? directory.error} />
      {#if people.error}<button type="button" class="secondary" onclick={people.reload}>Retry loading people</button>{/if}
      {#if directory.error}<button type="button" class="secondary" onclick={directory.reload}>Retry loading agents</button>{/if}
    </fieldset>
    <ErrorNote error={action.error} />
    <footer class="dialog-footer">
      <button type="button" class="secondary" disabled={action.busy} onclick={onClose}>Done</button>
      <button disabled={action.busy || !selected.length}>{action.busy ? 'Adding…' : selected.length ? `Add (${selected.length})` : 'Add'}</button>
    </footer>
  </form>
</Modal>
