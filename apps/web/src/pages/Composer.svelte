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
  import { buildMessagePreview } from '../message-format';
  import { conversationName } from '../appearance';
  let {
    conversationId,
    title,
    members,
    directory,
    tasks,
    replyTo = $bindable(null),
    body = $bindable(''),
    revision = $bindable(null),
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
    revision: Task | null;
    onPosted: () => void;
    onAdd: (id: string) => Promise<unknown>;
    onAttach: () => void;
  } = $props();
  let revisionSent = $state('');
  let mentions = $state<ParticipantRef[]>([]);
  let input = $state<HTMLTextAreaElement>();
  let caret = $state(0);
  let selected = $state(0);
  let dismissed = $state(false);
  const action = createAction();
  let query = $derived(/(?:^|\s)@([^@\n]*)$/.exec(body.slice(0, caret))?.[1]);
  let candidates = $derived(
    [
      ...members
        .filter((member) => !member.deleted)
        .map((member) => ({
          id: member.participant.id,
          name: member.name,
          type: member.participant.type,
          inside: true,
          purpose: member.purpose
        })),
      ...directory
        .filter((agent) => !members.some((member) => member.participant.id === agent.id))
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          type: 'agent' as const,
          inside: false,
          purpose: agent.purpose
        }))
    ]
      .filter(
        (member) => query !== undefined && member.name.toLowerCase().includes(query.toLowerCase())
      )
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
    if (!mentions.some((mention) => mention.id === member.id))
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
        (agent) =>
          mentions.some((mention) => mention.id === agent.id) &&
          !members.some((member) => member.participant.id === agent.id)
      )
      .map((agent) => ({
        name: agent.name,
        participant: { type: 'agent' as const, id: agent.id }
      }));
    const refs = [...members.filter((member) => !member.deleted), ...selectedMembers]
      .filter((member) =>
        new RegExp(
          `(?:^|\\s)@${member.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`,
          'iu'
        ).test(body)
      )
      .map((member) => member.participant);
    void action
      .run(() =>
        revision
          ? api.post<Task>(`/tasks/${revision.id}/restart`, { reason: body })
          : api.post(`/conversations/${conversationId}/messages`, {
              body,
              mentions: refs,
              ...(replyTo && { inReplyToMessageId: replyTo.id }),
              clientKey: crypto.randomUUID()
            })
      )
      .then((ok) => {
        if (ok) {
          revisionSent = revision
            ? `Changes sent to ${members.find((member) => member.participant.id === revision?.ownerAgentId)?.name ?? 'the agent'} as a linked new run.`
            : '';
          revision = null;
          body = '';
          mentions = [];
          replyTo = null;
          onPosted();
        }
      });
  };
</script>

<div class="composer-area">
  {#if revision}
    <div class="reply-bar row">
      <Icon name="reply" />
      <span class="grow">Changes to <strong>{revision.title}</strong> · {members.find((member) => member.participant.id === revision?.ownerAgentId)?.name ?? 'Deleted agent'} · creates a linked new run</span>
      <button class="quiet icon-button" aria-label="Cancel revision" onclick={() => { revision = null; replyTo = null; }}><Icon name="close" /></button>
    </div>
  {/if}
  {#if revisionSent}<p class="caption muted" role="status">{revisionSent}</p>{/if}
  {#if replyTo && !revision}<div class="reply-bar row">
      <Icon name="reply" /><span class="grow ellipsis"
        >Replying to <strong
          >{members.find((member) => member.participant.id === replyTo?.authorId)?.name ?? 'Platform'}</strong
        >: {buildMessagePreview(replyTo.body)}</span
      ><button class="quiet icon-button" aria-label="Cancel reply" onclick={() => (replyTo = null)}
        ><Icon name="close" /></button
      >
    </div>{/if}
  <form
    class="composer"
    onsubmit={(event) => {
      event.preventDefault();
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
            onmousedown={(event) => event.preventDefault()}
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
                      (task) => task.ownerAgentId === member.id && task.state === 'working' && !task.pausedAt
                    )
                    ? 'Working'
                    : tasks.some(
                          (task) =>
                            task.ownerAgentId === member.id &&
                            !['completed', 'cancelled'].includes(task.state)
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
      placeholder={`Message ${conversationName(title)}`}
      rows={1}
      oninput={(event) => {
        caret = event.currentTarget.selectionStart;
        selected = 0;
        dismissed = false;
      }}
      onclick={(event) => {
        caret = event.currentTarget.selectionStart;
        dismissed = false;
      }}
      onkeydown={(event) => {
        if (picker && event.key === 'Escape') {
          dismissed = true;
          event.preventDefault();
        } else if (picker && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          selected =
            (selected + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) %
            Math.max(1, candidates.length);
        } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          if (picker && candidates.length) void pick(candidates[selected] ?? candidates[0]);
          else send();
        }
      }}></textarea>
    <button class="icon-button" aria-label={revision ? "Send changes" : "Send message"} disabled={action.busy || !body.trim()}
      ><Icon name="send" /></button
    >
  </form>
  <div class="caption muted composer-hint">
    Type @ to ask an agent or a person · Enter sends · Shift+Enter for a new line (the box grows)
  </div>
  <ErrorNote error={action.error} />
</div>
