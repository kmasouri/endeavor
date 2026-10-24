<script lang="ts">
  import type { Human } from './api';
  import Avatar from './Avatar.svelte';
  import ErrorNote from './ErrorNote.svelte';
  import Icon from './Icon.svelte';

  let {
    people,
    currentId,
    busy,
    error,
    onPick,
    onClose
  }: {
    people: Human[];
    currentId: string;
    busy: boolean;
    error: string | null;
    onPick: (id: string) => void;
    onClose: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    const element = dialog;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  });
</script>

<dialog
  bind:this={dialog}
  class="person-dialog"
  aria-labelledby="person-picker-title"
  oncancel={(event) => {
    event.preventDefault();
    if (!busy) onClose();
  }}
  onclick={(event) => {
    if (event.target !== dialog || busy || !dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      onClose();
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && busy) event.preventDefault();
    if (event.key === 'Tab' && dialog) {
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      );
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }}
>
  <button
    class="quiet icon-button close-picker"
    aria-label="Close person selector"
    disabled={busy}
    onclick={onClose}><Icon name="close" /></button
  >
  <h2 id="person-picker-title">Who's using this workspace?</h2>
  <p class="muted">Choose a person to continue.</p>
  <ul class="person-tiles" aria-label="People">
    {#each people as person (person.id)}
      <li>
        <button
          class="person-tile"
          class:current={person.id === currentId}
          disabled={busy}
          aria-label={`${person.name}${person.id === currentId ? ' (current person)' : ''}`}
          onclick={() => (person.id === currentId ? onClose() : onPick(person.id))}
        >
          <Avatar name={person.name} id={person.id} size="xl" />
          <strong>{person.name}</strong>
          <span class="caption muted"
            >{person.id === currentId ? 'Current person' : 'Switch to this person'}</span
          >
        </button>
      </li>
    {/each}
  </ul>
  <div class="picker-feedback" aria-live="polite">
    {#if busy}<p class="muted" role="status">Switching person…</p>{/if}
    <ErrorNote {error} />
  </div>
</dialog>

<style>
  .person-dialog {
    width: min(800px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    padding: 48px 32px 24px;
    background: var(--bg-100);
    color: var(--text-100);
    border: 1px solid var(--border-200);
    border-radius: 20px;
    box-shadow: var(--shadow-pop);
    text-align: center;
    overflow-y: auto;
  }
  .person-dialog::backdrop {
    background: var(--bg-000);
    opacity: 0.85;
  }
  :global([data-theme='light']) .person-dialog::backdrop {
    background: var(--text-100);
    opacity: 0.7;
  }
  .close-picker {
    position: absolute;
    top: 12px;
    right: 12px;
  }
  h2 {
    margin: 0 20px 8px;
    font-size: 24px;
    line-height: 1.25;
  }
  p {
    margin: 0;
  }
  .person-tiles {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px;
    padding: 28px 0 0;
    margin: 0;
    list-style: none;
  }
  .person-tiles li {
    min-width: 0;
    width: 160px;
  }
  .person-tile {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px 8px;
    background: transparent;
    color: var(--text-100);
    border: 1px solid transparent;
    border-radius: 14px;
  }
  .person-tile:hover:not(:disabled),
  .person-tile:focus-visible {
    background: var(--bg-200);
    border-color: var(--text-200);
  }
  .person-tile.current {
    border-color: var(--border-200);
  }
  .person-tile :global(.avatar) {
    width: 88px;
    height: 88px;
    border-radius: 20px;
    font-size: 32px;
  }
  .person-tile strong {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: 16px;
  }
  .person-tile .caption {
    font-size: 12px;
  }
  .picker-feedback {
    margin-top: 16px;
  }
  @media (max-width: 500px) {
    .person-dialog {
      padding: 48px 16px 20px;
    }
    h2 {
      font-size: 21px;
    }
    .person-tiles {
      gap: 8px;
    }
    .person-tiles li {
      width: 140px;
    }
  }
</style>
