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
  import { collectConversationArtifacts } from '../conversation-artifacts';
  import ErrorNote from '../ErrorNote.svelte';
  import Avatar from '../Avatar.svelte';
  import Icon from '../Icon.svelte';
  import { conversationName } from '../appearance';
  import { formatDateTime, formatShortTime } from '../components';
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
  let { conversationId, me, onReady, onRead }: {
    conversationId: string;
    me: Human;
    onReady?: (conversation: ConversationDetails) => boolean;
    // Called after the conversation is marked read, so the sidebar can refresh its counts.
    onRead?: () => void;
  } = $props();
  let draft = $state('');
  let showDetails = $state(false);
  let showMembers = $state(false);
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
  // Seeing the conversation marks it read up to the newest message shown, again whenever a
  // new one arrives while it is open.
  let markedRead: string | null = null;
  $effect(() => {
    const newest = messages.data?.data.at(-1);
    if (!newest) return;
    const key = `${conversationId}:${newest.id}`;
    if (key === markedRead) return;
    markedRead = key;
    api.put(`/conversations/${conversationId}/read`, { messageId: newest.id }).then(
      () => onRead?.(),
      () => {
        if (markedRead === key) markedRead = null;
      }
    );
  });
  let conversation = $derived(details.data!);
  let taskList = $derived(tasks.data?.data ?? []);
  let taskIds = $derived(new Set(taskList.map((task) => task.id)));
  let conversationApprovals = $derived((approvals.data?.data ?? []).filter((approval) => taskIds.has(approval.taskId)));
  let busy = $derived(taskList.filter((task) => !['completed', 'cancelled'].includes(task.state)));
  let artifacts = $derived(
    collectConversationArtifacts(outputs.data?.data ?? [], messages.data?.data ?? [], taskList)
  );
  let unattached = $derived(
    artifacts.filter((output) => !(messages.data?.data ?? []).some((message) => message.taskId === output.taskId))
  );
  const nameOf = (ref: { type: string; id: string | null }) =>
    conversation.members.find((member) => member.participant.type === ref.type && member.participant.id === ref.id)
      ?.name ??
    (ref.type === 'system'
      ? 'Platform'
      : (directory.data?.find((agent) => agent.id === ref.id)?.name ?? (ref.type === 'agent' ? 'Deleted agent' : 'Someone')));
  const waitingApproval = (task: Task) =>
    task.state === 'waiting' && !task.pausedAt
      ? conversationApprovals.find((approval) => approval.taskId === task.id)
      : undefined;
  const liveStatus = (task: Task) =>
    task.pausedAt
      ? 'is paused'
      : task.state === 'working'
        ? 'is working'
        : task.state === 'blocked'
          ? 'is stuck'
          : 'is waiting';
  const describeApproval = (approval: Approval | undefined) =>
    approval?.request.kind === 'access'
      ? `${approval.request.targetType} access to ${approval.request.name}`
      : 'an action';
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
    const task = taskList.find((candidate) => candidate.id === output.taskId);
    replyTo =
      messages.data?.data.findLast((message) => message.taskId === output.taskId && message.authorType === 'agent') ??
      null;
    draft = `${task ? '@' + nameOf({ type: 'agent', id: task.ownerAgentId }) + ' ' : ''}Please revise "${output.title}": `;
    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
  };
</script>

{#if details.error}<ErrorNote error={details.error} />{:else if !details.data}<p>Loading…</p>{:else}
  {#if showMembers}<Members
    {conversationId}
    {me}
    members={conversation.members}
    onChanged={details.reload}
    onClose={() => (showMembers = false)}
  />{/if}
  <div class="conversation-layout" class:with-details={showDetails}>
    <section class="thread">
      <header class="conversation-header">
        <div class="heading">
          <h1 title={conversation.title}>{conversationName(conversation.title)}</h1>
          <p>
            {conversation.members.filter((member) => member.participant.type === 'human').length} people · {conversation.members.filter(
              (member) => member.participant.type === 'agent'
            ).length} agents · Agents answer when you mention them
          </p>
        </div>
        <div class="header-actions">
          <button
            class="secondary members-button"
            aria-label={`${conversation.members.length} members. Show who's here`}
            onclick={() => (showMembers = true)}
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
              task={taskList.find((task) => task.id === output.taskId)}
              cost={costs.data?.tasks.find((taskCost) => taskCost.taskId === output.taskId)?.costUsd}
              onReply={() => revise(output)}
              onChanged={reload}
            />
          </div>{/each}
        {#each conversationApprovals as approval (approval.id)}<section class="conversation-approval inline-panel">
            <div class="row">
              <Avatar
                name={nameOf({ type: 'agent', id: approval.agentId })}
                id={approval.agentId}
                agent
              /><strong>{nameOf({ type: 'agent', id: approval.agentId })}</strong><span
                class="agent-label">agent</span
              >
            </div>
            <h2>
              Needs your OK{approval.request.kind === 'access'
                ? ` · ${approval.request.targetType === 'skill' ? 'Skill' : 'Connection'} access`
                : ''}
            </h2>
            <ApprovalCard
              {approval}
              agentName={nameOf({ type: 'agent', id: approval.agentId })}
              onDone={reload}
            />
          </section>{/each}
        {#each busy.filter((task) => (task.pausedAt || task.state !== 'working') && !(messages.data?.data ?? []).some((message) => message.authorType === 'agent' && message.authorId === task.ownerAgentId)) as task (task.id)}<div
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
                {#if waitingApproval(task)}is <span class="waiting-ok">waiting for your OK</span>
                  <span class="muted">· {describeApproval(waitingApproval(task))}</span
                  >{:else}{liveStatus(task)}{/if}</span
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
          {#each conversation.members.filter((member) => member.participant.type === 'human') as member (member.participant.id)}<div
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
                title={formatDateTime(output.createdAt)}>{formatShortTime(output.createdAt)}</time
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
