<script lang="ts">
  import { untrack } from 'svelte';
  import { type DirectoryEntry, type Member, type Message } from '../api';
  import { when } from '../components';
  import Suggestion from './Suggestion.svelte';

  let props: {
    messages: Message[];
    nameOf: (ref: { type: string; id: string | null }) => string;
    members: Member[];
    directory: DirectoryEntry[];
    onAdd: (agentId: string) => Promise<unknown>;
  } = $props();
  let end = $state<HTMLDivElement | null>(null);
  let count = $derived(props.messages.length);
  $effect(() => {
    count;
    untrack(() => {
      end?.scrollIntoView({ block: 'end' });
    });
  });
  let byId = $derived.by(() => new Map(props.messages.map((m) => [m.id, m])));
</script>

{#if count === 0}
  <p class="muted">No messages yet. Say hello, and mention an agent to ask it.</p>
{:else}
  <ol class="messages">
    {#each props.messages ?? [] as message (message.id)}
      {@const replyTo = message.inReplyToMessageId ? byId.get(message.inReplyToMessageId) : null}

      <li id={`m-${message.id}`} class={`message ${message.authorType}`}>
        <div class="meta">
          <strong>
            {props.nameOf({ type: message.authorType, id: message.authorId })}
          </strong>

          <span class="muted">
            {when(message.createdAt)}
          </span>

          {#if message.taskId}
            <a href={`#/tasks/${message.taskId}`}> task </a>
          {/if}

          {#if message.mentions.length > 0}
            <span class="muted">
              to {message.mentions.map((ref) => props.nameOf(ref)).join(', ')}
            </span>
          {/if}
        </div>

        {#if replyTo}
          <div class="reply-to muted">
            Replying to {props.nameOf({ type: replyTo.authorType, id: replyTo.authorId })}:
            {replyTo.body.slice(0, 80)}
          </div>
        {/if}

        <div class="body">
          {message.body}
        </div>

        <Suggestion {message} {...props} />
      </li>
    {/each}

    <div bind:this={end}></div>
  </ol>
{/if}
