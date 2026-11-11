<script lang="ts">
  import { api, type Conversation, type ProjectDetails } from '../api';
  import { createAction, createLoad } from '../state.svelte';
  import { loadAll } from './agent-data';
  import PageHeader from '../PageHeader.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import Icon from '../Icon.svelte';
  import Modal from '../Modal.svelte';
  import NewRequest from './NewRequest.svelte';
  import KnowledgeSources from './KnowledgeSources.svelte';
  import ProjectMembers from './ProjectMembers.svelte';
  import SchedulesPage from './SchedulesPage.svelte';
  let { projectId, onChanged, onCreated }: { projectId: string; onChanged: () => void; onCreated: (conversation: Conversation) => void } = $props();
  const project = createLoad(() => api.get<ProjectDetails>(`/projects/${projectId}`), () => [projectId], 10000);
  const endeavors = createLoad(() => loadAll<Conversation>(`/conversations?projectId=${projectId}&state=all`), () => [projectId], 10000);
  let tab = $state('Endeavors');
  let requesting = $state(false);
  let renaming = $state(false);
  let name = $state('');
  const action = createAction();
  const open = $derived((endeavors.data ?? []).filter((e) => e.state !== 'closed'));
  const closed = $derived((endeavors.data ?? []).filter((e) => e.state === 'closed'));
  async function update(changes: { name?: string; archived?: boolean }) {
    if (await action.run(() => api.patch(`/projects/${projectId}`, changes))) { renaming = false; project.reload(); onChanged(); }
  }
</script>
<div class="projects-page">
  <a href="#/projects" class="project-back">← Projects</a>
  <ErrorNote error={project.error} />
  {#if project.error}<button class="secondary" onclick={project.reload}>Retry project</button>{/if}
  {#if project.data}
    <PageHeader title={project.data.name} subtitle={project.data!.archivedAt ? 'Archived project' : 'One endeavor for each goal.'}>
      {#snippet actions()}
        <button class="secondary" onclick={() => { name = project.data!.name; renaming = true; }}>Rename</button>
        {#if !project.data!.isDefault}<button class="secondary" disabled={action.busy} onclick={() => update({ archived: !project.data!.archivedAt })}>{project.data!.archivedAt ? 'Restore project' : 'Archive project'}</button>{/if}
        <button disabled={Boolean(project.data!.archivedAt)} onclick={() => (requesting = true)}><Icon name="plus" /> New request</button>
      {/snippet}
    </PageHeader>
    <ErrorNote error={action.error} />
    <div class="project-tabs" role="group" aria-label="Project sections">
      {#each ['Endeavors', 'Knowledge sources', 'Members', 'Schedules'] as item (item)}<button class="secondary" class:chosen={tab === item} aria-pressed={tab === item} onclick={() => (tab = item)}>{item}</button>{/each}
    </div>
    {#if tab === 'Endeavors'}
      <ErrorNote error={endeavors.error} />
      {#if endeavors.error}<button class="secondary" onclick={endeavors.reload}>Retry endeavors</button>{/if}
      <h2>Open endeavors <span class="muted">· {open.length}</span></h2>
      {#snippet rows(items: Conversation[])}
        <div class="project-list">
          {#each items as endeavor (endeavor.id)}<a class="project-row" href={`#/conversations/${endeavor.id}`}><Icon name={endeavor.state === 'closed' ? 'check' : 'conversations'} /><span class="grow"><strong>{endeavor.title}</strong><span class="caption muted">{endeavor.goal || 'Waiting for the first request'}</span></span><span class="caption muted">{endeavor.state === 'closed' ? 'Closed' : 'Open'}</span></a>{/each}
        </div>
      {/snippet}
      {@render rows(open)}
      {#if endeavors.data && !open.length}<p class="muted">No open endeavors. Start with a new request.</p>{/if}
      {#if !endeavors.data && !endeavors.error}<p class="muted">Loading endeavors…</p>{/if}
      <details class="project-archive"><summary>Archived endeavors · {closed.length}</summary>{@render rows(closed)}</details>
    {:else if tab === 'Knowledge sources'}<KnowledgeSources {projectId} />
    {:else if tab === 'Members'}<ProjectMembers project={project.data} onChanged={project.reload} />
    {:else if tab === 'Schedules'}
      {#key projectId}<SchedulesPage project={project.data} />{/key}
    {/if}
    {#if requesting}<NewRequest project={project.data} {onCreated} onClose={() => (requesting = false)} />{/if}
    {#if renaming}<Modal title="Rename project" busy={action.busy} onClose={() => (renaming = false)}><form class="stack" onsubmit={(event) => { event.preventDefault(); void update({ name: name.trim() }); }}><label>Project name<input bind:value={name} maxlength="100" required disabled={action.busy} /></label><ErrorNote error={action.error} /><footer class="dialog-footer"><button type="button" class="secondary" disabled={action.busy} onclick={() => (renaming = false)}>Cancel</button><button disabled={action.busy || !name.trim()}>Save name</button></footer></form></Modal>{/if}
  {:else if !project.error}<p class="muted">Loading project…</p>{/if}
</div>
