<script lang="ts">
  import { api, type Connection } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';
  import ConnectionChoice from './ConnectionChoice.svelte';

  let props: {
    connections: Connection[];
    onCreated: () => void;
  } = $props();
  let name = $state('');
  let description = $state('');
  let instructions = $state('');
  let connectionIds = $state<string[]>([]);
  const action = createAction();
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post('/skills', { name, description, instructions, connectionIds }))
      .then((ok) => {
        if (ok) {
          name = '';
          description = '';
          instructions = '';
          connectionIds = [];
          props.onCreated();
        }
      });
  };
</script>

<details>
  <summary> New skill </summary>

  <form onsubmit={create} class="stack">
    <label>
      Name

      <input bind:value={name} required />
    </label>

    <label>
      Description

      <input bind:value={description} required />
    </label>

    <label>
      Instructions

      <textarea
        class="tall"
        bind:value={instructions}
        placeholder="How to do this kind of work, step by step."
        required></textarea>
    </label>

    <ConnectionChoice
      connections={props.connections}
      selected={connectionIds}
      onChange={(value) => (connectionIds = value)}
    />

    <button disabled={action.busy}> Create skill </button>

    <ErrorNote error={action.error} />
  </form>
</details>
