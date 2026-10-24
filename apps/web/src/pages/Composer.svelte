<script lang="ts">
  import { tick } from 'svelte';
  import {
    api,
    type DirectoryEntry,
    type Member,
    type Message,
    type ParticipantRef,
    type Task
  } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Avatar from '../Avatar.svelte';
  import Icon from '../Icon.svelte';
  import { createAction } from '../state.svelte';
  import { conversationName } from '../appearance';
  let {
    conversationId,
    title,
    members,
    directory,
    tasks,
    replyTo = $bindable(null),
    body = $bindable(''),
    onPosted,
    onAdd,
    onAttach
  }: {
    conversationId: string;
    title: string;
    members: Member[];
    directory: DirectoryEntry[];
    tasks: Task[];
    replyTo: Message | null;
    body: string;
    onPosted: () => void;
    onAdd: (id: string) => Promise<unknown>;
    onAttach: () => void;
  } = $props();
  let mentions = $state<ParticipantRef[]>([]);
  let input = $state<HTMLTextAreaElement>();
  let caret = $state(0);
  let selected = $state(0);
  let dismissed = $state(false);
  const action = createAction();
  let query = $derived(/(?:^|\s)@([^@\n]*)$/.exec(body.slice(0, caret))?.[1]);
  let candidates = $derived(
    [
      ...members.map((m) => ({
        id: m.participant.id,
        name: m.name,
        type: m.participant.type,
        inside: true,
        purpose: m.purpose
      })),
      ...directory
        .filter((a) => !members.some((m) => m.participant.id === a.id))
        .map((a) => ({
          id: a.id,
          name: a.name,
          type: 'agent' as const,
          inside: false,
          purpose: a.purpose
        }))
    ]
      .filter((m) => query !== undefined && m.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8)
  );
  let picker = $derived(query !== undefined && !dismissed);
  const pick = async (member: (typeof candidates)[number]) => {
    const ok = await action.run(async () => {
      if (!member.inside) await onAdd(member.id);
    });
    if (!ok) return;
    const start = body.slice(0, caret).lastIndexOf('@');
    body = body.slice(0, start) + `@${member.name} ` + body.slice(caret);
    if (!mentions.some((m) => m.id === member.id))
      mentions = [...mentions, { type: member.type, id: member.id }];
    caret = start + member.name.length + 2;
    dismissed = true;
    await tick();
    input?.focus();
    input?.setSelectionRange(caret, caret);
  };
  const send = () => {
    if (!body.trim() || action.busy) return;
    // Text pasted or typed in full works just like selecting a member in the picker.
    const selectedMembers = directory
      .filter(
        (a) =>
          mentions.some((m) => m.id === a.id) && !members.some((m) => m.participant.id === a.id)
      )
      .map((a) => ({ name: a.name, participant: { type: 'agent' as const, id: a.id } }));
    const refs = [...members, ...selectedMembers]
      .filter((m) =>
        new RegExp(
          `(?:^|\\s)@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`,
          'iu'
        ).test(body)
      )
      .map((m) => m.participant);
    void action
      .run(() =>
        api.post(`/conversations/${conversationId}/messages`, {
          body,
          mentions: refs,
          ...(replyTo && { inReplyToMessageId: replyTo.id }),
          clientKey: crypto.randomUUID()
        })
      )
      .then((ok) => {
        if (ok) {
          body = '';
          mentions = [];
          replyTo = null;
          onPosted();
        }
      });
  };
</script>

<div class="composer-area">
  {#if replyTo}<div class="reply-bar row">
      <Icon name="reply" /><span class="grow ellipsis"
        >Replying to… {members.find((m) => m.participant.id === replyTo?.authorId)?.name ??
          'Platform'}: {replyTo.body.slice(0, 100)}</span
      ><button class="quiet icon-button" aria-label="Cancel reply" onclick={() => (replyTo = null)}
        ><Icon name="close" /></button
      >
    </div>{/if}
  <form
    class="composer"
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    {#if picker}
      <div class="mention-picker" role="listbox" id="mention-picker" aria-label="People and agents">
        <div class="label">People and agents</div>
        {#each candidates as member, i (member.id)}
          <button
            type="button"
            class:chosen={i === selected}
            role="option"
            aria-selected={i === selected}
            disabled={action.busy}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => void pick(member)}
          >
            <Avatar name={member.name} id={member.id} agent={member.type === 'agent'} />
            <span class="grow"
              >{member.name}
              {#if member.type === 'agent'}<span class="agent-label">agent</span>{/if}
              {#if member.purpose}<span class="picker-purpose caption muted">{member.purpose}</span
                >{/if}</span
            >
            <span class="caption muted"
              >{!member.inside
                ? 'Add to conversation'
                : member.type === 'agent'
                  ? tasks.some(
                      (t) => t.ownerAgentId === member.id && t.state === 'working' && !t.pausedAt
                    )
                    ? 'Working'
                    : tasks.some(
                          (t) =>
                            t.ownerAgentId === member.id &&
                            !['completed', 'cancelled'].includes(t.state)
                        )
                      ? 'Busy'
                      : 'Free'
                  : 'Person'}</span
            >
          </button>
        {/each}
        {#if !candidates.length}<p class="muted">No matches.</p>{/if}
      </div>
    {/if}
    <button
      type="button"
      class="quiet icon-button"
      aria-label="Attach a document"
      onclick={onAttach}><Icon name="attach" /></button
    >
    <textarea
      bind:this={input}
      bind:value={body}
      aria-label="Message"
      aria-controls={picker ? 'mention-picker' : undefined}
      placeholder={`Message #${conversationName(title)}`}
      rows={1}
      oninput={(e) => {
        caret = e.currentTarget.selectionStart;
        selected = 0;
        dismissed = false;
      }}
      onclick={(e) => {
        caret = e.currentTarget.selectionStart;
        dismissed = false;
      }}
      onkeydown={(e) => {
        if (picker && e.key === 'Escape') {
          dismissed = true;
          e.preventDefault();
        } else if (picker && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          selected =
            (selected + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) %
            Math.max(1, candidates.length);
        } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          if (picker && candidates.length) void pick(candidates[selected] ?? candidates[0]);
          else send();
        }
      }}></textarea>
    <button class="icon-button" aria-label="Send message" disabled={action.busy || !body.trim()}
      ><Icon name="send" /></button
    >
  </form>
  <div class="caption muted composer-hint">
    Type @ to ask an agent or a person · Enter sends · Shift+Enter for a new line (the box grows)
  </div>
  <ErrorNote error={action.error} />
</div>
