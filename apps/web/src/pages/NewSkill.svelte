<script lang="ts">
  import { api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import PageHeader from '../PageHeader.svelte';
  import './creation.css';
  import { createAction, go } from '../state.svelte';

  let name = $state('');
  let description = $state('');
  let instructions = $state('');
  let discoverable = $state(false);
  const action = createAction();
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post('/skills', { name, description, instructions, discoverable }))
      .then((ok) => {
        if (ok) {
          go('/skills');
        }
      });
  };
</script>

<div class="creation-page">
  <a class="creation-back" href="#/skills">← Skills</a>
  <PageHeader
    title="New skill"
    subtitle="Give it a name and reusable instructions for your agents."
  />

  <form onsubmit={create} class="creation-form">
    <fieldset class="stack">
      <legend>Profile</legend>
      <label>
        Name

        <input bind:value={name} required />
      </label>

      <label>
        Description

        <input bind:value={description} required />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={discoverable} />
        Agents can find this and ask for access. Finding it grants nothing.
      </label>
    </fieldset>
    <fieldset class="stack">
      <legend>Instructions</legend>
      <label>
        Instructions

        <textarea
          class="tall skill-instructions"
          bind:value={instructions}
          placeholder="How to do this kind of work, step by step."
          required></textarea>
      </label>
    </fieldset>
    <ErrorNote error={action.error} />
    <div class="savebar">
      <a href="#/skills">Cancel</a>
      <button disabled={action.busy || !name.trim() || !description.trim() || !instructions.trim()}>Create skill</button>
    </div>
  </form>
</div>
