<script lang="ts">
  import { api, type DirectoryEntry, type Human, type ProjectDetails } from '../api';
  import { createAction, createLoad } from '../state.svelte';
  import Avatar from '../Avatar.svelte';
  import Modal from '../Modal.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  let { project, onChanged }: { project: ProjectDetails; onChanged: () => void } = $props();
  let editing = $state(false);
  let selected = $state<string[]>([]);
  let query = $state('');
  const directory = createLoad(() => api.get<DirectoryEntry[]>('/directory'), () => []);
  const people = createLoad(() => api.get<Human[]>('/humans'), () => []);
  const choices = $derived([...new Map([
    ...project.members.map((m) => ({ ...m, id: m.participant.id, type: m.participant.type })),
    ...(people.data ?? []).map((p) => ({ ...p, type: 'human' as const, purpose: 'Person', avatarColor: null, avatarIcon: null })),
    ...(directory.data ?? []).map((a) => ({ ...a, type: 'agent' as const }))
  ].map((m) => [`${m.type}:${m.id}`, m])).values()]);
  const action = createAction();
  function edit() { selected = project.members.map((m) => `${m.participant.type}:${m.participant.id}`); query = ''; editing = true; }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    const ids = (type: string) => choices.filter((m) => m.type === type && selected.includes(`${type}:${m.id}`)).map((m) => m.id);
    if (await action.run(() => api.patch(`/projects/${project.id}`, { humanIds: ids('human'), agentIds: ids('agent') }))) { editing = false; onChanged(); }
  }
</script>
<section>
  <div class="row wrap"><h2 class="grow">Default members</h2><button class="secondary" onclick={edit}>Edit members</button></div>
  <p class="muted">Added to new endeavors. Existing endeavors keep their members.</p>
  {#each project.members as member (`${member.participant.type}:${member.participant.id}`)}
    <div class="person-line row"><Avatar name={member.name} id={member.participant.id} appearance={member} agent={member.participant.type === 'agent'} /><span>{member.name}{member.deleted ? ' (deleted)' : ''}<span class="caption muted">{member.purpose || 'Person'}</span></span></div>
  {/each}
  {#if !project.members.length}<p class="muted">No default members.</p>{/if}
</section>
{#if editing}
  <Modal title="Project members" busy={action.busy} onClose={() => (editing = false)}>
    <form class="stack" onsubmit={save}>
      <label>Find people or agents<input type="search" bind:value={query} /></label>
      <ErrorNote error={directory.error ?? people.error} />
      {#if directory.error || people.error}<button type="button" class="secondary" onclick={() => { directory.reload(); people.reload(); }}>Retry members</button>{/if}
      <fieldset disabled={action.busy} class="endeavor-members">
        <legend>Default people and agents</legend>
        {#each choices.filter((m) => `${m.name} ${m.purpose}`.toLowerCase().includes(query.toLowerCase())) as member (`${member.type}:${member.id}`)}
          <label class="check endeavor-member"><Avatar name={member.name} id={member.id} appearance={member} agent={member.type === 'agent'} /><span class="grow">{member.name}</span><input type="checkbox" aria-label={`Include ${member.name}`} checked={selected.includes(`${member.type}:${member.id}`)} onchange={() => { const key = `${member.type}:${member.id}`; selected = selected.includes(key) ? selected.filter((s) => s !== key) : [...selected, key]; }} /></label>
        {/each}
      </fieldset>
      <ErrorNote error={action.error} />
      <footer class="dialog-footer"><button type="button" class="secondary" disabled={action.busy} onclick={() => (editing = false)}>Cancel</button><button disabled={action.busy}>Save members</button></footer>
    </form>
  </Modal>
{/if}
