<script lang="ts">
  import { untrack } from 'svelte';
  import { api, type SkillDetails } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  let props: {
    skill: SkillDetails;
    onSaved: () => void;
  } = $props();
  let instructions = $state(untrack(() => props.skill.currentVersion?.instructions ?? ''));
  const action = createAction();
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post(`/skills/${props.skill.id}/versions`, { instructions }))
      .then((ok) => ok && props.onSaved());
  };
</script>

<form onsubmit={save} class="stack">
  <span class="muted small">
    Version {props.skill.currentVersion?.version}
  </span>

  <label>
    Instructions
    <textarea class="tall skill-instructions" bind:value={instructions} required></textarea>
  </label>
  <p class="muted small">Saving creates a new version. Agents keep their pinned version until their setup is saved again.</p>

  <button disabled={action.busy}> Save new version </button>

  <ErrorNote error={action.error} />
</form>
