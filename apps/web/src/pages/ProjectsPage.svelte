<script lang="ts">
  import { api, type Project } from '../api';
  import { createAction, createLoad, go } from '../state.svelte';
  import { loadAll } from './agent-data';
  import PageHeader from '../PageHeader.svelte';
  import ManagementToolbar from '../ManagementToolbar.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import Modal from '../Modal.svelte';
  import Icon from '../Icon.svelte';
  let { onChanged }: { onChanged: () => void } = $props();
  let filter = $state('Active');
  let search = $state('');
  let creating = $state(false);
  let name = $state('');
  const projects = createLoad(() => loadAll<Project>(`/projects?archived=${filter === 'Archived'}`), () => [filter], 10000);
  const shown = $derived((projects.data ?? []).filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())));
  const action = createAction();
  async function create(event: SubmitEvent) {
    event.preventDefault();
    await action.run(async () => {
      const project = await api.post<Project>('/projects', { name: name.trim() });
      creating = false; onChanged(); go(`/projects/${project.id}`);
    });
  }
</script>
<div class="projects-page">
  <PageHeader title="Projects" subtitle="Shared knowledge and people. One endeavor for each goal.">
    {#snippet actions()}<button onclick={() => (creating = true)}><Icon name="plus" /> New project</button>{/snippet}
  </PageHeader>
  <ManagementToolbar name="projects" filters={['Active', 'Archived']} bind:filter bind:search />
  <ErrorNote error={projects.error} />
  {#if projects.error}<button class="secondary" onclick={projects.reload}>Retry projects</button>{/if}
  {#if !projects.data && !projects.error}<p class="muted">Loading projects…</p>{/if}
  <div class="project-list">
    {#each shown as project (project.id)}
      <a class="project-row" href={`#/projects/${project.id}`}><Icon name="catalogs" /><span class="grow"><strong>{project.name}</strong><span class="caption muted">{project.archivedAt ? 'Archived' : project.isDefault ? 'Default project' : 'Open project'}</span></span><span aria-hidden="true">›</span></a>
    {/each}
  </div>
  {#if projects.data && !shown.length}<p class="muted">No {filter.toLowerCase()} projects match.</p>{/if}
</div>
{#if creating}
  <Modal title="New project" busy={action.busy} onClose={() => (creating = false)}>
    <form class="stack" onsubmit={create}>
      <label>Project name<input bind:value={name} maxlength="100" required disabled={action.busy} /></label>
      <ErrorNote error={action.error} />
      <footer class="dialog-footer"><button type="button" class="secondary" disabled={action.busy} onclick={() => (creating = false)}>Cancel</button><button disabled={action.busy || !name.trim()}>Create project</button></footer>
    </form>
  </Modal>
{/if}
