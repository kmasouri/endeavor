<script lang="ts">
  import { untrack } from 'svelte';
  import type { Conversation, Project } from './api';
  import { conversationName } from './appearance';
  import ErrorNote from './ErrorNote.svelte';
  import Icon from './Icon.svelte';
  import ProjectGlyph from './ProjectGlyph.svelte';
  import ProjectPopover from './ProjectPopover.svelte';

  let { projects, conversations, selectedProjectId, selectedConversationId, projectSelected, projectError, conversationError, onNewEndeavor, onEditProject, onNavigate }: {
    projects: Project[];
    conversations: Conversation[];
    selectedProjectId?: string;
    selectedConversationId?: string;
    projectSelected: boolean;
    projectError: string | null;
    conversationError: string | null;
    onNewEndeavor: (id: string) => void;
    onEditProject: (project: Project | null) => void;
    onNavigate: () => void;
  } = $props();

  let expanded = $state<Record<string, boolean>>({});
  $effect(() => {
    const projectId = selectedProjectId;
    if (projectId) untrack(() => { expanded = { ...expanded, [projectId]: true }; });
  });
  const groups = $derived([
    ...projects.filter((project) => !project.archivedAt || conversations.some((item) => item.projectId === project.id))
      .map((project) => ({ id: project.id, name: project.name, project, endeavors: conversations.filter((item) => item.projectId === project.id) })),
    // If the project list fails, existing endeavors are still reachable.
    ...[...new Set(conversations.flatMap((item) => item.projectId ? [item.projectId] : []))]
      .filter((id) => !projects.some((project) => project.id === id))
      .map((id) => ({ id, name: 'Project', project: null, endeavors: conversations.filter((item) => item.projectId === id) }))
  ]);
  const standalone = $derived(conversations.filter((item) => !item.projectId));
  const unreadIn = (conversation: Conversation) =>
    conversation.id === selectedConversationId ? 0 : conversation.unreadCount ?? 0;
</script>

{#snippet rows(endeavors: Conversation[])}
  {#each endeavors as conversation (conversation.id)}
    {@const unread = unreadIn(conversation)}
    <a
      class:active={selectedConversationId === conversation.id}
      class:unread={unread > 0}
      aria-label={unread ? `${conversationName(conversation.title)}, ${unread} unread` : undefined}
      aria-current={selectedConversationId === conversation.id ? 'page' : undefined}
      href={`#/conversations/${conversation.id}`}
      title={conversation.title}
      onclick={onNavigate}
    >
      <span class="ellipsis grow">{conversationName(conversation.title)}</span>
      {#if unread}<span class="count-badge" aria-hidden="true">{unread}</span>{/if}
    </a>
  {:else}
    <span class="caption muted project-empty">No open endeavors</span>
  {/each}
{/snippet}

<section class="sidebar-projects" aria-label="Projects">
  <div class="sidebar-section-heading">
    <a class="sidebar-section-label" href="#/projects" aria-label="Manage projects" title="Manage projects" onclick={onNavigate}>Projects</a>
    <button type="button" class="quiet icon-button" aria-label="New project" title="New project" onclick={() => onEditProject(null)}><Icon name="plus" size={16} /></button>
  </div>
  <ErrorNote error={projectError} />
  <ErrorNote error={conversationError} />
  {#each groups as group (group.id)}
    {@const open = expanded[group.id] ?? (group.id === selectedProjectId || Boolean(group.project?.isDefault) || !group.project)}
    {@const unread = group.endeavors.reduce((count, conversation) => count + unreadIn(conversation), 0)}
    <div class="sidebar-project">
      <div class="sidebar-project-row" class:project-current={projectSelected && selectedProjectId === group.id}>
        <button
          type="button"
          class="quiet sidebar-project-toggle"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${group.name}`}
          aria-expanded={open}
          aria-controls={`project-endeavors-${group.id}`}
          title={group.name}
          onclick={() => { expanded = { ...expanded, [group.id]: !open }; }}
        >
          <ProjectGlyph project={group.project} />
          <span class="ellipsis grow">{group.name}</span>
          {#if !open && unread}<span class="count-badge" aria-label={`${unread} unread`}>{unread}</span>{/if}
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        </button>
        {#if group.project}
          {@const project = group.project}
          <div class="project-row-actions">
            <ProjectPopover label={`Project options for ${project.name}`} className="quiet icon-button">
              {#snippet trigger()}<Icon name="ellipsis" size={16} />{/snippet}
              {#snippet children(close)}
                <button type="button" class="quiet row" onclick={() => { close(); onEditProject(project); }}><Icon name="edit" size={16} /> Edit</button>
                <a class="project-menu-link row" href={`#/projects/${project.id}`} onclick={() => { close(); onNavigate(); }}><Icon name="folder" size={16} /> Open project</a>
              {/snippet}
            </ProjectPopover>
            {#if !project.archivedAt}
              <button type="button" class="quiet icon-button" aria-label={`New endeavor in ${project.name}`} title={`New endeavor in ${project.name}`} onclick={() => onNewEndeavor(project.id)}><Icon name="plus" size={16} /></button>
            {/if}
          </div>
        {/if}
      </div>
      <div class="sidebar-conversations sidebar-project-endeavors" id={`project-endeavors-${group.id}`} hidden={!open}>
        {@render rows(group.endeavors)}
      </div>
    </div>
  {/each}
  {#if standalone.length}
    <div class="sidebar-section-heading"><span class="sidebar-section-label">No project</span></div>
    <div class="sidebar-conversations">{@render rows(standalone)}</div>
  {/if}
</section>
