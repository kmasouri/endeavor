<script lang="ts">
  import { untrack } from 'svelte';
  import {
    type CostReport,
    type DirectoryEntry,
    type Member,
    type Message,
    type Task,
    type TaskOutput
  } from '../api';
  import { collectConversationArtifacts } from '../conversation-artifacts';
  import { buildMessagePreview } from '../message-format';
  import { formatDateTime, formatShortTime } from '../components';
  import FormattedText from '../FormattedText.svelte';
  import Avatar from '../Avatar.svelte';
  import Icon from '../Icon.svelte';
  import Suggestion from './Suggestion.svelte';
  import TaskStatus from './TaskStatus.svelte';
  import RunSteps from './RunSteps.svelte';
  import ArtifactCard from './ArtifactCard.svelte';
  let props: {
    messages: Message[];
    nameOf: (ref: { type: string; id: string | null }) => string;
    members: Member[];
    directory: DirectoryEntry[];
    meId: string;
    tasks: Task[];
    outputs: (TaskOutput & { taskId: string })[];
    costs?: CostReport;
    onAdd: (agentId: string) => Promise<unknown>;
    onReply: (message: Message) => void;
    onRevise: (output: TaskOutput & { taskId: string }) => void;
    onChanged: () => void;
    onInspect: (message: Message) => void;
    onInspectRun: (id: string) => void;
    selectedRunId?: string;
  } = $props();
  let end = $state<HTMLDivElement | null>(null);
  let copied = $state('');
  let copyError = $state('');
  let count = $derived(props.messages.length);
  $effect(() => {
    count;
    untrack(() => {
      end?.scrollIntoView({ block: 'end' });
    });
  });
  let artifacts = $derived(
    collectConversationArtifacts(props.outputs, props.messages, props.tasks)
  );
  let byId = $derived.by(() => new Map(props.messages.map((message) => [message.id, message])));
  let lastForTask = $derived.by(
    () =>
      new Map(
        props.messages
          .filter((message) => message.taskId)
          .map((message) => [message.taskId, message.id])
      )
  );
  let lastForAgent = $derived.by(
    () =>
      new Map(
        props.messages
          .filter((message) => message.authorType === 'agent')
          .map((message) => [message.authorId, message.id])
      )
  );
  let names = $derived(
    props.members.map((member) => ({
      name: member.name,
      you: member.participant.id === props.meId
    }))
  );
  const copy = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.body);
      copied = message.id;
      copyError = '';
    } catch {
      copyError = 'Could not copy. Select the message text to copy it.';
    }
  };
</script>

{#if !count}<p class="empty-conversation muted">
    No messages yet. Say hello, and mention an agent to ask it.
  </p>{/if}
<ol class="messages">
  {#each props.messages as message, i (message.id)}
    {@const previous = props.messages[i - 1]}
    {@const grouped =
      !message.inReplyToMessageId &&
      previous &&
      previous.authorType === message.authorType &&
      previous.authorId === message.authorId &&
      new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString() &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 300000}
    {@const replyTo = message.inReplyToMessageId ? byId.get(message.inReplyToMessageId) : null}
    {@const name = props.nameOf({ type: message.authorType, id: message.authorId })}
    {@const you = message.mentions.some((mention) => mention.id === props.meId && mention.type === 'human')}
    {#if !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString()}<li
        class="date-divider"
      >
        <span
          >{new Date(message.createdAt).toLocaleDateString([], {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
          })}</span
        >
      </li>{/if}
    <li
      id={`m-${message.id}`}
      class="message"
      class:selected-run={Boolean(message.taskId && message.taskId === props.selectedRunId)}
      class:grouped
      class:mentioned-you={you}
      class:has-reply={Boolean(replyTo)}
    >
      {#if replyTo}
        {@const replyName = props.nameOf({ type: replyTo.authorType, id: replyTo.authorId })}
        <a
          class="reply-preview"
          href={`#m-${replyTo.id}`}
          aria-label={`Reply to ${replyName}: ${buildMessagePreview(replyTo.body)}`}
          onclick={(event) => {
            event.preventDefault();
            document.getElementById(`m-${replyTo.id}`)?.scrollIntoView({ block: 'center' });
          }}
        >
          <svg
            class="reply-connector"
            width="22"
            height="12"
            viewBox="0 0 22 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"><path d="M1 12V6a5 5 0 015-5h16" /></svg
          >
          <Avatar
            name={replyName}
            id={replyTo.authorId ?? 'platform'}
            agent={replyTo.authorType === 'agent'}
            size="sm"
          />
          <strong class="reply-name">{replyName}</strong>
          <span class="reply-excerpt">{buildMessagePreview(replyTo.body)}</span>
        </a>
      {/if}
      <div class="message-avatar">
        {#if !grouped}<Avatar
            {name}
            id={message.authorId ?? 'platform'}
            agent={message.authorType === 'agent'}
            size="lg"
          />{/if}
      </div>
      <div class="message-content">
        {#if !grouped}<div class="meta">
            <strong>{name}</strong><time class="caption muted" title={formatDateTime(message.createdAt)}
              >{formatShortTime(message.createdAt)}</time
            >
          </div>{:else}<time class="group-time caption muted" title={formatDateTime(message.createdAt)}
            >{formatShortTime(message.createdAt)}</time
          >{/if}
        <div class="message-body"><FormattedText text={message.body} {names} /></div>
        {#if message.taskId && lastForTask.get(message.taskId) === message.id}
          {#if !props.outputs.some((output) => output.taskId === message.taskId) || artifacts.some((output) => output.taskId === message.taskId)}<RunSteps
              taskId={message.taskId}
              onInspect={props.onInspectRun}
            />{/if}
          {#each artifacts.filter((output) => output.taskId === message.taskId) as output (output.id)}<ArtifactCard
              {output}
              task={props.tasks.find((task) => task.id === message.taskId)}
              cost={props.costs?.tasks.find((taskCost) => taskCost.taskId === message.taskId)?.costUsd}
              onInspect={props.onInspectRun}
              onReply={() => props.onRevise(output)}
              onChanged={props.onChanged}
            />{/each}
        {/if}
        {#if lastForAgent.get(message.authorId) === message.id}
          {#each props.tasks.filter((task) => task.ownerAgentId === message.authorId && !['completed', 'cancelled'].includes(task.state)) as task (task.id)}<TaskStatus
              {task}
              costs={props.costs}
              onChanged={props.onChanged}
            />{/each}
        {/if}
        <Suggestion {message} {...props} />
      </div>
      <div class="message-actions" aria-label="Message actions">
        <button class="quiet icon-button" aria-label="Reply" onclick={() => props.onReply(message)}
          ><Icon name="reply" /></button
        ><button
          class="quiet icon-button"
          aria-label={copied === message.id ? 'Copied' : 'Copy'}
          onclick={() => void copy(message)}
          ><Icon name={copied === message.id ? 'check' : 'copy'} /></button
        >{#if message.authorType === 'agent'}<button
            class="quiet icon-button"
            aria-label="See what this agent did"
            title={message.taskId ? "Inspect this run" : "No run was recorded for this message"}
            onclick={() => props.onInspect(message)}><Icon name="history" /></button
          >{/if}
      </div>
    </li>
  {/each}
</ol>
{#if copyError}<p class="error">{copyError}</p>{/if}
<div bind:this={end}></div>
