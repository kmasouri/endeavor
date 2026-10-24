<script lang="ts">
  import { api, type Member, type Message, type ParticipantRef } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction } from '../state.svelte';

  let props: {
    conversationId: string;
    members: Member[];
    messages: Message[];
    nameOf: (ref: { type: string; id: string | null }) => string;
    onPosted: () => void;
  } = $props();
  let body = $state('');
  let mentions = $state<ParticipantRef[]>([]);
  let replyTo = $state('');
  const action = createAction();
  let agents = $derived(props.members.filter((m) => m.participant.type === 'agent'));
  let recent = $derived(props.messages.slice(-10).reverse());
  const toggle = (ref: ParticipantRef) => {
    mentions = mentions.some((value) => value.id === ref.id)
      ? mentions.filter((value) => value.id !== ref.id)
      : [...mentions, ref];
  };
  const send = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() =>
        api.post(`/conversations/${props.conversationId}/messages`, {
          body,
          mentions,
          ...(replyTo && { inReplyToMessageId: replyTo }),
          clientKey: crypto.randomUUID()
        })
      )
      .then((ok) => {
        if (ok) {
          body = '';
          replyTo = '';
          props.onPosted();
        }
      });
  };
</script>

<form onsubmit={send} class="composer stack">
  <textarea
    bind:value={body}
    placeholder="Write a message. Add context, ask a question, or redirect the work."
    rows={3}
    required></textarea>

  <div class="row wrap">
    <span class="muted"> Ask: </span>

    {#if agents.length === 0}
      <span class="muted"> no agents here yet </span>
    {/if}

    {#each agents ?? [] as member (member.participant.id)}
      <label class="chip">
        <input
          type="checkbox"
          checked={mentions.some((x) => x.id === member.participant.id)}
          oninput={() => toggle(member.participant)}
        />
        {member.name}
      </label>
    {/each}
  </div>

  <div class="row wrap">
    <label class="grow">
      <span class="muted"> In reply to </span>

      <select bind:value={replyTo}>
        <option value=""> (nothing) </option>

        {#each recent ?? [] as message (message.id)}
          <option value={message.id}>
            {props.nameOf({ type: message.authorType, id: message.authorId })}:
            {message.body.slice(0, 60)}
          </option>
        {/each}
      </select>
    </label>

    <button disabled={action.busy || !body.trim()}> Send </button>
  </div>

  {#if mentions.length === 0 && body.trim()}
    <Hint>No one is mentioned, so this message starts no work.</Hint>
  {/if}

  <ErrorNote error={action.error} />
</form>
