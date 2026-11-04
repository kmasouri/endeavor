<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let { title, busy = false, wide = false, dismissOnBackdrop = false, onClose, children }: {
    title: string;
    busy?: boolean;
    wide?: boolean;
    dismissOnBackdrop?: boolean;
    onClose: () => void;
    children: Snippet;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let startedOnBackdrop = false;
  const isBackdrop = (event: MouseEvent, element: HTMLDialogElement) => {
    const bounds = element.getBoundingClientRect();
    return event.target === element && (
      event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom
    );
  };
  $effect(() => {
    const element = dialog;
    const opener = document.activeElement;
    element?.showModal();
    // Focus the primary field; the native dialog makes the rest of the app inert.
    element?.querySelector<HTMLElement>('input, textarea')?.focus();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  });
</script>

<dialog
  bind:this={dialog}
  class="endeavor-dialog"
  class:endeavor-dialog-wide={wide}
  aria-labelledby="endeavor-dialog-title"
  onpointerdown={(event) => {
    startedOnBackdrop = isBackdrop(event, event.currentTarget);
  }}
  onpointercancel={() => { startedOnBackdrop = false; }}
  onclick={(event) => {
    const fromBackdrop = startedOnBackdrop;
    startedOnBackdrop = false;
    if (dismissOnBackdrop && !busy && fromBackdrop && isBackdrop(event, event.currentTarget)) {
      onClose();
    }
  }}
  oncancel={(event) => {
    event.preventDefault();
    if (!busy) onClose();
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), a[href], textarea:not(:disabled), select:not(:disabled)'
    )).filter((element) => element.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }}
>
  <div class="row dialog-heading">
    <h2 id="endeavor-dialog-title" class="grow">{title}</h2>
    <button class="quiet icon-button" aria-label="Close" disabled={busy} onclick={onClose}>
      <Icon name="close" />
    </button>
  </div>
  {@render children()}
</dialog>
