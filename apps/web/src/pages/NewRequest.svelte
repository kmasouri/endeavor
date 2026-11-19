<script lang="ts">
  import { tick } from 'svelte';
  import { api, type Conversation, type Project } from '../api';
  import { canonicalConversationName } from '../appearance';
  import { createAction } from '../state.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import Icon from '../Icon.svelte';
  import ProjectEditor from '../ProjectEditor.svelte';
  import ProjectGlyph from '../ProjectGlyph.svelte';
  import ProjectPopover from '../ProjectPopover.svelte';

  let { initialProjectId, projects, projectError, onProjectSaved, onCreated, onGuard, onDirty }: {
    initialProjectId: string | null;
    projects: Project[];
    projectError: string | null;
    onProjectSaved: (project: Project) => void;
    onCreated: (conversation: Conversation) => void;
    onGuard: (guard: () => boolean) => void;
    onDirty: (dirty: boolean) => void;
  } = $props();

  const initialProject = () => initialProjectId;
  let projectId = $state(initialProject());
  let request = $state('');
  let search = $state('');
  let creatingProject = $state(false);
  let created = $state<Conversation | null>(null);
  let input: HTMLTextAreaElement;
  let form: HTMLFormElement;
  const clientKey = crypto.randomUUID();
  const action = createAction();
  const project = $derived(projects.find((item) => item.id === projectId));
  const unavailable = $derived(projectId !== null && (!project || !!project.archivedAt));
  const options = $derived(projects.filter((item) =>
    !item.archivedAt && item.name.toLowerCase().includes(search.trim().toLowerCase())
  ));

  $effect(() => {
    input.focus();
    onGuard(() => !action.busy && (!request.trim() || window.confirm('Discard this draft?')));
  });
  $effect(() => onDirty(Boolean(request.trim())));

  async function chooseProject(id: string | null) {
    projectId = id;
    search = '';
    await tick();
    input.focus();
  }

  function start(event: SubmitEvent) {
    event.preventDefault();
    if (!request.trim() || (!created && unavailable)) return;
    void action.run(async () => {
      // A retry after the first message fails uses the same endeavor and message key.
      created ??= await api.post<Conversation>('/conversations', {
        projectId,
        title: canonicalConversationName(request).slice(0, 64).replace(/-$/, '') || 'new-endeavor'
      });
      await api.post(`/conversations/${created.id}/messages`, { body: request.trim(), clientKey });
      onCreated(created);
    });
  }
</script>

<section class="new-endeavor-pane" aria-label="New endeavor">
  <div class="new-endeavor-heading">
    <h1>{project ? `What should we work on in ${project.name}?` : 'What should we work on?'}</h1>
  </div>
  <div class="composer-area">
    <form bind:this={form} class="composer" onsubmit={start}>
      <textarea
        bind:this={input}
        bind:value={request}
        aria-label="First message"
        placeholder="Describe what you want to accomplish…"
        rows={1}
        maxlength={20000}
        readonly={action.busy || !!created}
        onkeydown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            form.requestSubmit();
          }
        }}
      ></textarea>
      <button class="icon-button" aria-label={created ? 'Retry first message' : 'Send message'} disabled={action.busy || !request.trim() || (!created && unavailable)}>
        <Icon name="send" />
      </button>
    </form>
    <div class="new-endeavor-footer">
      <ProjectPopover above label={`Project: ${project?.name ?? (projectId ? 'Unavailable' : 'Standalone')}`} className="quiet project-context" disabled={action.busy || !!created}>
        {#snippet trigger()}
          <ProjectGlyph {project} />
          <span class="ellipsis">{project?.name ?? (projectId ? 'Unavailable' : 'Standalone')}</span>
          <Icon name="chevron-down" size={12} />
        {/snippet}
        {#snippet children(close)}
          <input aria-label="Search projects" type="search" placeholder="Search projects" bind:value={search} />
          <div class="project-picker-list">
            {#each options as option (option.id)}
              <button type="button" class="quiet row" aria-pressed={projectId === option.id} onclick={() => { close(); void chooseProject(option.id); }}>
                <ProjectGlyph project={option} /><span class="grow ellipsis">{option.name}</span>
                {#if projectId === option.id}<Icon name="check" size={16} />{/if}
              </button>
            {:else}
              <p class="caption muted">{projectError || (search ? 'No matching projects' : 'No projects')}</p>
            {/each}
          </div>
          <button type="button" class="quiet row" onclick={() => { close(); search = ''; creatingProject = true; }}><Icon name="plus" size={16} /> New project</button>
          <button type="button" class="quiet row" aria-pressed={projectId === null} onclick={() => { close(); void chooseProject(null); }}><Icon name="close" size={16} /> Don’t work in a project</button>
        {/snippet}
      </ProjectPopover>
      <span class="caption muted">Enter sends · Shift+Enter for a new line</span>
    </div>
    {#if unavailable && !created}<p class="caption muted">Choose an available project or work standalone.</p>{/if}
    <ErrorNote error={action.error} />
    {#if created && action.error}
      <p class="caption">The endeavor was created. Retry the first message or <a href={`#/conversations/${created.id}`}>open it</a>.</p>
    {/if}
  </div>
</section>

{#if creatingProject}
  <ProjectEditor onClose={() => (creatingProject = false)} onSaved={(saved) => {
    creatingProject = false;
    onProjectSaved(saved);
    void chooseProject(saved.id);
  }} />
{/if}
