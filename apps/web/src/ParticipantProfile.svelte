<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { DirectoryEntry, Member } from './api';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let { name, id, agent = false, meId, member, directory, avatar = false, children }: {
    name: string;
    id: string;
    agent?: boolean;
    meId: string;
    member?: Member;
    directory?: DirectoryEntry;
    avatar?: boolean;
    children: Snippet;
  } = $props();
  const uid = $props.id();
  let trigger: HTMLButtonElement;
  let card: HTMLDivElement;
  let open = $state(false);
  let purpose = $derived(member?.purpose || directory?.purpose);
  let capabilities = $derived(agent ? directory?.capabilities : undefined);
  let available = $derived(!member?.deleted && Boolean(member || directory));

  const position = () => {
    const anchor = trigger.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.left, window.innerWidth - bounds.width - 12));
    const below = anchor.bottom + 8;
    const top = below + bounds.height <= window.innerHeight - 12
      ? below : Math.max(12, anchor.top - bounds.height - 8);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };
  const close = () => {
    card.hidePopover();
    trigger.focus({ preventScroll: true });
  };
  $effect(() => {
    if (!open) return;
    position();
    const observer = new ResizeObserver(position);
    observer.observe(card);
    window.addEventListener('resize', position);
    // A scrolling message should not leave its card floating over unrelated content.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && card.contains(event.target)) return;
      card.hidePopover();
    };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', onScroll, true);
    };
  });
</script>

<button
  bind:this={trigger}
  type="button"
  class="participant-trigger"
  class:participant-avatar={avatar}
  aria-label={`View ${name}'s profile`}
  aria-haspopup="dialog"
  aria-expanded={open}
  popovertarget={uid}
>{@render children()}</button>
<div
  bind:this={card}
  id={uid}
  popover="auto"
  role="dialog"
  tabindex="-1"
  aria-label={`${name}'s profile`}
  class="participant-profile"
  ontoggle={(event) => { open = event.newState === 'open'; }}
>
  <div class="row participant-profile-heading">
    <Avatar {name} {id} {agent} size="xl" />
    <button type="button" class="quiet icon-button" aria-label="Close profile" onclick={close}><Icon name="close" /></button>
  </div>
  <h2>{name}</h2>
  <p class="caption muted">{agent ? 'Agent' : 'Person'}{id === meId && !agent ? ' · You' : ''}{member?.deleted ? ' · Deleted' : ''}</p>
  {#if purpose}<p class="participant-purpose">{purpose}</p>{/if}
  {#if capabilities && !member?.deleted}
    <dl class="participant-capabilities">
      <div><dt>Model</dt><dd>{capabilities.model}</dd></div>
      <div><dt>Provider</dt><dd>{capabilities.provider}</dd></div>
      <div><dt>Access</dt><dd>{capabilities.skillCount} {capabilities.skillCount === 1 ? 'skill' : 'skills'} · {capabilities.connectionCount} {capabilities.connectionCount === 1 ? 'connection' : 'connections'}</dd></div>
    </dl>
  {/if}
  {#if member?.deleted}<p class="caption muted">This agent has been deleted. Their messages remain in the conversation.</p>
  {:else if agent && !available}<p class="caption muted">This agent's details are no longer available.</p>{/if}
  {#if agent && available}
    <a class="button secondary participant-profile-action" href={`#/agents/${encodeURIComponent(id)}`} onclick={() => card.hidePopover()}>View agent</a>
  {:else if !agent && id === meId}
    <a class="button secondary participant-profile-action" href="#/settings" onclick={() => card.hidePopover()}>Edit profile</a>
  {/if}
</div>
