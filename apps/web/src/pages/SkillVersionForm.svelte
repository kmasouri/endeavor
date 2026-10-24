<script lang="ts">
  import { untrack } from 'svelte';
  import { api, type Connection, type SkillDetails } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';
  import ConnectionChoice from './ConnectionChoice.svelte';

  let props: {
    skill: SkillDetails;
    connections: Connection[];
    onSaved: () => void;
  } = $props();
  let instructions = $state(untrack(() => props.skill.currentVersion?.instructions ?? ''));
  let connectionIds = $state(untrack(() => props.skill.currentVersion?.connectionIds ?? []));
  const action = createAction();
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post(`/skills/${props.skill.id}/versions`, { instructions, connectionIds }))
      .then((ok) => ok && props.onSaved());
  };
</script>

<form onsubmit={save} class="stack">
  <span class="muted small">
    Version {props.skill.currentVersion?.version}
  </span>

  <textarea class="tall" bind:value={instructions} required></textarea>

  <ConnectionChoice
    connections={props.connections}
    selected={connectionIds}
    onChange={(value) => (connectionIds = value)}
  />

  <button disabled={action.busy}> Save new version </button>

  <ErrorNote error={action.error} />
</form>
