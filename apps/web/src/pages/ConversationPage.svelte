<script lang="ts">
  import { tick } from 'svelte';
  import {
    api,
    type Approval,
    type ConversationDetails,
    type CostReport,
    type DirectoryEntry,
    type Human,
    type Message,
    type Task,
    type TaskOutput
  } from '../api';
  import { conversationArtifacts } from '../conversation-artifacts';
  import ErrorNote from '../ErrorNote.svelte';
  import Avatar from '../Avatar.svelte';
  import Icon from '../Icon.svelte';
  import { conversationName } from '../appearance';
  import { when, shortTime } from '../components';
  import { createLoad } from '../state.svelte';
  import KnowledgeSources from './KnowledgeSources.svelte';
  import Spending from './Spending.svelte';
  import MessageList from './MessageList.svelte';
  import Composer from './Composer.svelte';
  import Members from './Members.svelte';
  import ConversationAgents from './ConversationAgents.svelte';
  import ApprovalCard from './ApprovalCard.svelte';
  import TaskStatus from './TaskStatus.svelte';
  import ArtifactCard from './ArtifactCard.svelte';
  let { conversationId, me, onReady }: {
    conversationId: string;
    me: Human;
    onReady?: (conversation: ConversationDetails) => boolean;
  } = $props();
  let draft = $state('');
  let showDetails = $state(false);
  let adding = $state(false);
  let attaching = $state(false);
  let replyTo = $state<Message | null>(null);
  const details = createLoad(
    () => api.get<ConversationDetails>(`/conversations/${conversationId}`),
    () => [conversationId]
  );
  const messages = createLoad(
    () => api.list<Message>(`/conversations/${conversationId}/messages?limit=500`),
    () => [conversationId],
    2500
  );
  const directory = createLoad(
    () => api.get<DirectoryEntry[]>('/directory'),
    () => []
  );
  const tasks = createLoad(
    () => api.list<Task>(`/tasks?conversationId=${conversationId}&limit=100`),
    () => [conversationId],
    4000
  );
  const outputs = createLoad(
    () =>
      api.list<TaskOutput & { taskId: string }>(
        `/conversations/${conversationId}/outputs?limit=100`
      ),
    () => [conversationId],
    5000
  );
  const costs = createLoad(
    () => api.get<CostReport>(`/conversations/${conversationId}/costs`),
    () => [conversationId],
    15000
  );
  const approvals = createLoad(
    () => api.list<Approval>('/approvals?status=pending&limit=100'),
    () => [],
    4000
  );
  $effect(() => {
    if (details.data && onReady?.(details.data)) {
      void tick().then(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
    }
  });
  let conversation = $derived(details.data!);
  let taskList = $derived(tasks.data?.data ?? []);
  let memberIds = $derived(new Set(taskList.map((t) => t.id)));
  let mine = $derived((approvals.data?.data ?? []).filter((a) => memberIds.has(a.taskId)));
  let busy = $derived(taskList.filter((t) => !['completed', 'cancelled'].includes(t.state)));
  let artifacts = $derived(
    conversationArtifacts(outputs.data?.data ?? [], messages.data?.data ?? [], taskList)
  );
  let unattached = $derived(
    artifacts.filter((o) => !(messages.data?.data ?? []).some((m) => m.taskId === o.taskId))
  );
  const nameOf = (ref: { type: string; id: string | null }) =>
    conversation.members.find((m) => m.participant.type === ref.type && m.participant.id === ref.id)
      ?.name ??
    (ref.type === 'system'
      ? 'Platform'
      : (directory.data?.find((a) => a.id === ref.id)?.name ?? (ref.type === 'agent' ? 'Deleted agent' : 'Someone')));
  const onAdd = (id: string) =>
    api
      .post(`/conversations/${conversationId}/members`, { type: 'agent', id })
      .then(details.reload);
  const reload = () => {
    tasks.reload();
    messages.reload();
    outputs.reload();
    approvals.reload();
    costs.reload();
  };
  const reply = (message: Message) => {
    replyTo = message;
    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
  };
  const revise = (output: TaskOutput & { taskId: string }) => {
    const task = taskList.find((t) => t.id === output.taskId);
    replyTo =
      messages.data?.data.findLast((m) => m.taskId === output.taskId && m.authorType === 'agent') ??
      null;
    draft = `${task ? '@' + nameOf({ type: 'agent', id: task.ownerAgentId }) + ' ' : ''}Please revise "${output.title}": `;
    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
  };
</script>

{#if details.error}<ErrorNote error={details.error} />{:else if !details.data}<p>Loading…</p>{:else}
  <div class="conversation-layout" class:with-details={showDetails}>
    <section class="thread">
      <header class="conversation-header">
        <div class="heading">
          <h1 title={conversation.title}>{conversationName(conversation.title)}</h1>
          <p>
            {conversation.members.filter((m) => m.participant.type === 'human').length} people · {conversation.members.filter(
              (m) => m.participant.type === 'agent'
            ).length} agents · Agents answer when you mention them
          </p>
        </div>
        <div class="header-actions">
          <button
            class="secondary members-button"
            aria-label={`${conversation.members.length} members. Show who's here`}
            onclick={() => (showDetails = true)}
          >
            {#each conversation.members.slice(0, 4) as member (member.participant.id)}<Avatar
                name={member.name}
                id={member.participant.id}
                agent={member.participant.type === 'agent'}
              />{/each}
            {#if conversation.members.length > 4}<span class="caption"
                >+{conversation.members.length - 4}</span
              >{/if}
          </button>
          <button class="secondary add-members-button" onclick={() => (adding = !adding)}
            ><Icon name="plus" /><span>Add people or agents</span></button
          >
          <button
            class="secondary"
            class:chosen={showDetails}
            aria-label={showDetails ? 'Hide details' : 'Show details'}
            aria-pressed={showDetails}
            onclick={() => (showDetails = !showDetails)}
            ><Icon name="panel" /><span class="details-button-label">Details</span></button
          >
        </div>
      </header>
      <div class="conversation-scroll">
        {#if adding}<section class="inline-panel">
            <div class="row">
              <h2 class="grow">Add people or agents</h2>
              <button
                class="quiet icon-button"
                aria-label="Close member picker"
                onclick={() => (adding = false)}><Icon name="close" /></button
              >
            </div>
            <Members
              {conversationId}
              {me}
              members={conversation.members}
              directory={directory.data ?? []}
              onChanged={details.reload}
            />
          </section>{/if}
        {#if attaching}<section class="inline-panel">
            <div class="row">
              <h2 class="grow">Attach context</h2>
              <button
                class="quiet icon-button"
                aria-label="Close attachments"
                onclick={() => (attaching = false)}><Icon name="close" /></button
              >
            </div>
            <KnowledgeSources {conversationId} />
          </section>{/if}
        <ErrorNote error={messages.error ?? tasks.error ?? outputs.error ?? approvals.error} />
        <MessageList
          messages={messages.data?.data ?? []}
          {nameOf}
          members={conversation.members}
          directory={directory.data ?? []}
          meId={me.id}
          tasks={taskList}
          outputs={outputs.data?.data ?? []}
          costs={costs.data}
          {onAdd}
          onReply={reply}
          onRevise={revise}
          onChanged={reload}
        />
        {#each unattached as output (output.id)}<div class="orphan-artifact">
            <ArtifactCard
              {output}
              task={taskList.find((t) => t.id === output.taskId)}
              cost={costs.data?.tasks.find((t) => t.taskId === output.taskId)?.costUsd}
              onReply={() => revise(output)}
              onChanged={reload}
            />
          </div>{/each}
        {#each mine as approval (approval.id)}<section class="conversation-approval inline-panel">
            <div class="row">
              <Avatar
                name={nameOf({ type: 'agent', id: approval.agentId })}
                id={approval.agentId}
                agent
              /><strong>{nameOf({ type: 'agent', id: approval.agentId })}</strong><span
                class="agent-label">agent</span
              >
            </div>
            <h2>Needs your OK</h2>
            <ApprovalCard {approval} onDone={reload} />
          </section>{/each}
        {#each busy.filter((t) => (t.pausedAt || t.state !== 'working') && !(messages.data?.data ?? []).some((m) => m.authorType === 'agent' && m.authorId === t.ownerAgentId)) as task (task.id)}<div
            class="conversation-state"
          >
            <div class="row">
              <Avatar
                name={nameOf({ type: 'agent', id: task.ownerAgentId })}
                id={task.ownerAgentId}
                agent
              /><strong>{nameOf({ type: 'agent', id: task.ownerAgentId })}</strong><span
                class="agent-label">agent</span
              >
            </div>
            <TaskStatus {task} costs={costs.data} onChanged={reload} />
          </div>{/each}
      </div>
      <div class="conversation-bottom">
        {#if busy.length}<div class="live-status caption" aria-live="polite">
            {#each busy as task (task.id)}<span
                ><strong>{nameOf({ type: 'agent', id: task.ownerAgentId })}</strong>
                {task.pausedAt
                  ? 'is paused'
                  : task.state === 'working'
                    ? 'is working'
                    : task.state === 'blocked'
                      ? 'is stuck'
                      : 'is waiting'}</span
              >{/each}
          </div>{/if}
        <Composer
          {conversationId}
          title={conversation.title}
          members={conversation.members}
          directory={directory.data ?? []}
          tasks={taskList}
          bind:replyTo
          bind:body={draft}
          onPosted={reload}
          {onAdd}
          onAttach={() => (attaching = !attaching)}
        />
      </div>
    </section>
    {#if showDetails}<aside class="conversation-details" aria-label="Conversation details">
        <div class="row">
          <div class="grow">
            <h2>Details</h2>
            <p class="caption muted">Who's here, what they're doing, artifacts, spending</p>
          </div>
          <button
            class="quiet icon-button"
            aria-label="Close details"
            onclick={() => (showDetails = false)}><Icon name="close" /></button
          >
        </div>
        <section>
          <h2 class="label">People</h2>
          {#each conversation.members.filter((m) => m.participant.type === 'human') as member (member.participant.id)}<div
              class="person-line row"
            >
              <Avatar name={member.name} id={member.participant.id} /><span
                >{member.name}{member.participant.id === me.id ? ' (you)' : ''}</span
              >
            </div>{/each}
        </section>
        <ConversationAgents
          members={conversation.members}
          tasks={taskList}
          {conversationId}
          onChanged={reload}
        />
        <section>
          <h2 class="label">Artifacts</h2>
          {#each artifacts as output (output.id)}<a
              class="artifact-line row"
              href={`#/tasks/${output.taskId}`}
              ><Icon name="file" /><span class="grow ellipsis">{output.title}</span><time
                class="caption muted"
                title={when(output.createdAt)}>{shortTime(output.createdAt)}</time
              ></a
            >{/each}{#if !artifacts.length}<p class="caption muted">None yet.</p>{/if}
        </section>
        <section>
          <Spending kind="conversation" id={conversationId} onBudgetSaved={costs.reload} />
        </section>
        <details><summary>Knowledge sources</summary><KnowledgeSources {conversationId} /></details>
      </aside>{/if}
  </div>
{/if}
