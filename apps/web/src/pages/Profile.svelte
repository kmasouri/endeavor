<script lang="ts">
  import { untrack } from 'svelte';
  import { type Agent, api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction } from '../state.svelte';

  let {
    agent,
    onSaved
  }: {
    agent: Agent;
    onSaved: () => void;
  } = $props();
  let name = $state(untrack(() => agent.name));
  let purpose = $state(untrack(() => agent.purpose));
  const action = createAction();
  let changed = $derived(name !== agent.name || purpose !== agent.purpose);
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.patch(`/agents/${agent.id}`, { name, purpose }))
      .then((ok) => ok && onSaved());
  };
</script>

<form onsubmit={save} class="panel stack">
  <h2>Profile</h2>

  <Hint>Name and purpose aren't versioned. Changes show up everywhere at once.</Hint>

  <label>
    Name

    <input bind:value={name} required />
  </label>

  <label>
    Purpose

    <input bind:value={purpose} required />
  </label>

  <button disabled={action.busy || !changed}> Save profile </button>

  <ErrorNote error={action.error} />
</form>
