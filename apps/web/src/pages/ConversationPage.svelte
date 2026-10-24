<script lang="ts">
  import {
    api,
    type ConversationDetails,
    type DirectoryEntry,
    type Human,
    type Message
  } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { when } from '../components';
  import { createLoad } from '../state.svelte';
  import ContextExplainer from './ContextExplainer.svelte';
  import KnowledgeSources from './KnowledgeSources.svelte';
  import Spending from './Spending.svelte';
  import MessageList from './MessageList.svelte';
  import Composer from './Composer.svelte';
  import Members from './Members.svelte';
  import ConversationTasks from './ConversationTasks.svelte';
  import ConversationOutputs from './ConversationOutputs.svelte';

  let {
    conversationId,
    me
  }: {
    conversationId: string;
    me: Human;
  } = $props();
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
  let conversation = $derived(details.data!);
  const nameOf = (ref: { type: string; id: string | null }) =>
    conversation.members.find((m) => m.participant.type === ref.type && m.participant.id === ref.id)
      ?.name ?? (ref.type === 'system' ? 'Platform' : 'Someone');
</script>

{#if details.error}
  <ErrorNote error={details.error} />
{:else if !details.data}
  <p>Loading…</p>
{:else}
  <div class="columns">
    <section class="thread">
      <h1>
        {conversation.title}
      </h1>

      <Hint>
        Agents answer when you mention them. This is the conversation history: agents see the part
        they're allowed to. Closing this page doesn't stop agents' work.
      </Hint>

      <ErrorNote error={messages.error} />

      <MessageList
        messages={messages.data?.data ?? []}
        {nameOf}
        members={conversation.members}
        directory={directory.data ?? []}
        onAdd={(agentId) =>
          api
            .post(`/conversations/${conversationId}/members`, { type: 'agent', id: agentId })
            .then(details.reload)}
      />

      <Composer
        {conversationId}
        members={conversation.members}
        messages={messages.data?.data ?? []}
        {nameOf}
        onPosted={messages.reload}
      />
    </section>

    <aside>
      <div class="panel">
        <ConversationTasks {conversationId} />
      </div>

      <div class="panel">
        <ConversationOutputs {conversationId} />
      </div>

      <div class="panel">
        <Spending kind="conversation" id={conversationId} />
      </div>

      <div class="panel">
        <KnowledgeSources {conversationId} />

        <ContextExplainer />
      </div>

      <div class="panel">
        <Members
          {conversationId}
          {me}
          members={conversation.members}
          directory={directory.data ?? []}
          onChanged={details.reload}
        />
      </div>
    </aside>
  </div>
{/if}
