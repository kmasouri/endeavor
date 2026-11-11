<script lang="ts">
  import { type Project } from '../api';
  import { createLoad, go } from '../state.svelte';
  import { loadAll } from './agent-data';
  import PageHeader from '../PageHeader.svelte';
  import ManagementToolbar from '../ManagementToolbar.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import ProjectEditor from '../ProjectEditor.svelte';
  import ProjectGlyph from '../ProjectGlyph.svelte';
  import Icon from '../Icon.svelte';
  let { onChanged }: { onChanged: () => void } = $props();
  let filter = $state('Active');
  let search = $state('');
  let creating = $state(false);
  const projects = createLoad(() => loadAll<Project>(`/projects?archived=${filter === 'Archived'}`), () => [filter], 10000);
  const shown = $derived((projects.data ?? []).filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())));
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
      <a class="project-row" href={`#/projects/${project.id}`}><ProjectGlyph {project} /><span class="grow"><strong>{project.name}</strong><span class="caption muted">{project.archivedAt ? 'Archived' : project.isDefault ? 'Default project' : 'Open project'}</span></span><span aria-hidden="true">›</span></a>
    {/each}
  </div>
  {#if projects.data && !shown.length}<p class="muted">No {filter.toLowerCase()} projects match.</p>{/if}
</div>
{#if creating}
  <ProjectEditor onClose={() => (creating = false)} onSaved={(project) => {
    creating = false;
    onChanged();
    go(`/projects/${project.id}`);
  }} />
{/if}
