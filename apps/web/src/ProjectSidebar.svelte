<script lang="ts">
  import { untrack } from 'svelte';
  import type { Conversation, Project } from './api';
  import { conversationChannelName } from './appearance';
  import ErrorNote from './ErrorNote.svelte';
  import Icon from './Icon.svelte';

  let { projects, conversations, selectedProjectId, selectedConversationId, projectSelected, projectError, conversationError, onNavigate }: {
    projects: Project[];
    conversations: Conversation[];
    selectedProjectId?: string;
    selectedConversationId?: string;
    projectSelected: boolean;
    projectError: string | null;
    conversationError: string | null;
    onNavigate: () => void;
  } = $props();
  let expanded = $state<Record<string, boolean>>({});
  $effect(() => {
    const projectId = selectedProjectId;
    if (projectId) untrack(() => { expanded = { ...expanded, [projectId]: true }; });
  });
  const groups = $derived([
    ...projects.filter((project) => !project.archivedAt || conversations.some((c) => c.projectId === project.id))
      .map((project) => ({ id: project.id, name: project.name, project, endeavors: conversations.filter((c) => c.projectId === project.id) })),
    // Keep accessible endeavors reachable if project details have not loaded or failed.
    ...[...new Set(conversations.map((c) => c.projectId).filter((id): id is string => Boolean(id)))]
      .filter((id) => !projects.some((project) => project.id === id))
      .map((id) => ({ id, name: 'Project', project: null, endeavors: conversations.filter((c) => c.projectId === id) })),
    // Older clients may omit projectId.
    ...((!projects.length && !conversations.length) || conversations.some((c) => !c.projectId) ? [{
      id: 'unassigned', name: 'General', project: null, endeavors: conversations.filter((c) => !c.projectId)
    }] : [])
  ]);
  const unreadIn = (conversation: Conversation) => conversation.id === selectedConversationId ? 0 : conversation.unreadCount ?? 0;
</script>

<a class="sidebar-projects-heading" href="#/projects" aria-label="Manage projects" title="Manage projects" onclick={onNavigate}><Icon name="folder" /><span class="sidebar-label">Projects</span></a>
<section class="sidebar-projects" aria-label="Projects">
  <ErrorNote error={projectError} />
  <ErrorNote error={conversationError} />
  {#each groups as group (group.id)}
    {@const open = expanded[group.id] ?? (group.id === selectedProjectId || Boolean(group.project?.isDefault) || !group.project)}
    {@const unread = group.endeavors.reduce((count, conversation) => count + unreadIn(conversation), 0)}
    <div class="sidebar-project">
      <div class="sidebar-project-row">
        <button class="quiet project-disclosure" aria-label={`${open ? 'Collapse' : 'Expand'} ${group.name}`} aria-expanded={open} aria-controls={`project-endeavors-${group.id}`} onclick={() => { expanded = { ...expanded, [group.id]: !open }; }}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} /></button>
        {#if group.project}
          <a class="sidebar-project-link" class:active={projectSelected && selectedProjectId === group.id} aria-current={projectSelected && selectedProjectId === group.id ? 'page' : undefined} href={`#/projects/${group.id}`} title={`${group.name}${group.project.archivedAt ? ' (archived)' : ''}`} onclick={onNavigate}><Icon name="folder" size={16} /><span class="ellipsis grow">{group.name}</span>{#if !open && unread}<span class="count-badge" aria-label={`${unread} unread`}>{unread}</span>{/if}</a>
        {:else}
          <span class="sidebar-project-link"><Icon name="folder" size={16} /><span class="ellipsis grow">{group.name}</span></span>
        {/if}
      </div>
      <div class="sidebar-conversations" id={`project-endeavors-${group.id}`} hidden={!open}>
        {#each group.endeavors as conversation (conversation.id)}
          <a class:active={selectedConversationId === conversation.id} class:unread={unreadIn(conversation) > 0} aria-label={unreadIn(conversation) ? `${conversationChannelName(conversation.title)}, ${unreadIn(conversation)} unread` : undefined} aria-current={selectedConversationId === conversation.id ? 'page' : undefined} href={`#/conversations/${conversation.id}`} title={conversation.title} onclick={onNavigate}><span class="ellipsis grow">{conversationChannelName(conversation.title)}</span>{#if unreadIn(conversation)}<span class="count-badge" aria-hidden="true">{unreadIn(conversation)}</span>{/if}</a>
        {:else}
          <span class="caption muted project-empty">No open endeavors</span>
        {/each}
      </div>
    </div>
  {/each}
</section>
