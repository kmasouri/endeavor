<script lang="ts">
  import { api, type DirectoryEntry, type Human, type Member } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { when } from '../components';
  import { createAction, createLoad } from '../state.svelte';

  let props: {
    conversationId: string;
    me: Human;
    members: Member[];
    directory: DirectoryEntry[];
    onChanged: () => void;
  } = $props();
  const people = createLoad(
    () => api.get<Human[]>('/humans'),
    () => []
  );
  let choice = $state('');
  let history = $state<'all' | 'from_now'>('all');
  const action = createAction();
  let inside = $derived(new Set(props.members.map((m) => m.participant.id)));
  let agentChoices = $derived(props.directory.filter((agent) => !inside.has(agent.id)));
  let peopleChoices = $derived((people.data ?? []).filter((person) => !inside.has(person.id)));
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    const [type, id] = choice.split(':');
    void action
      .run(() => api.post(`/conversations/${props.conversationId}/members`, { type, id, history }))
      .then((ok) => ok && ((choice = ''), props.onChanged()));
  };
</script>

<h2>Members</h2>

<ul class="list">
  {#each props.members ?? [] as member (member.participant.id)}
    <li>
      <strong>
        {member.name}
      </strong>

      <span class="muted">
        ·

        {#if member.participant.type === 'agent'}
          agent
        {:else}
          person
        {/if}

        {#if member.participant.id === props.me.id}
          (you)
        {/if}
      </span>

      {#if member.purpose}
        <div class="muted small">
          {member.purpose}
        </div>
      {/if}

      {#if member.historyFrom}
        <div class="muted small">
          Sees messages from {when(member.historyFrom)}
        </div>
      {/if}
    </li>
  {/each}
</ul>

<h3>Add someone</h3>

<Hint>
  Only people add members. An added agent can read the conversation history you allow, but never
  other conversations or anyone's credentials.
</Hint>

<form onsubmit={add} class="stack">
  <select bind:value={choice} required>
    <option value=""> Choose… </option>

    {#if agentChoices.length > 0}
      <optgroup label="Agents (directory)">
        {#each agentChoices ?? [] as agent (agent.id)}
          <option value={`agent:${agent.id}`}>
            {agent.name}: {agent.purpose}
          </option>
        {/each}
      </optgroup>
    {/if}

    {#if peopleChoices.length > 0}
      <optgroup label="People">
        {#each peopleChoices ?? [] as person (person.id)}
          <option value={`human:${person.id}`}>
            {person.name}
          </option>
        {/each}
      </optgroup>
    {/if}
  </select>

  <label class="check">
    <input
      type="checkbox"
      checked={history === 'from_now'}
      oninput={(event) => (history = event.currentTarget.checked ? 'from_now' : 'all')}
    />
    Hide earlier messages from them
  </label>

  <button disabled={action.busy || !choice}> Add </button>

  <ErrorNote error={action.error} />
</form>
