<script lang="ts">
  import { api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  let props: {
    onCreated: () => void;
  } = $props();
  let name = $state('');
  let description = $state('');
  let instructions = $state('');
  const action = createAction();
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post('/skills', { name, description, instructions }))
      .then((ok) => {
        if (ok) {
          name = '';
          description = '';
          instructions = '';
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
        class="tall skill-instructions"
        bind:value={instructions}
        placeholder="How to do this kind of work, step by step."
        required></textarea>
    </label>

    <button disabled={action.busy}> Create skill </button>

    <ErrorNote error={action.error} />
  </form>
</details>
