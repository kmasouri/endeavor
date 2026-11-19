<script lang="ts">
  import type { Snippet } from 'svelte';

  let { label, above = false, className = '', disabled = false, trigger, children }: {
    label: string;
    above?: boolean;
    className?: string;
    disabled?: boolean;
    trigger: Snippet;
    children: Snippet<[() => void]>;
  } = $props();

  const uid = $props.id();
  let anchor: HTMLButtonElement;
  let panel: HTMLDivElement;
  let open = $state(false);

  function position() {
    const rect = anchor.getBoundingClientRect();
    panel.style.maxHeight = `${Math.max(0, above ? rect.top - 16 : innerHeight - 24)}px`;
    const size = panel.getBoundingClientRect();
    const left = above ? rect.left : rect.right - size.width;
    panel.style.left = `${Math.max(8, Math.min(left, innerWidth - size.width - 8))}px`;
    const top = above ? rect.top - size.height - 8 : Math.min(rect.bottom + 4, innerHeight - size.height - 8);
    panel.style.top = `${Math.max(8, top)}px`;
  }

  function close() {
    panel.hidePopover();
    anchor.focus({ preventScroll: true });
  }

  $effect(() => {
    if (!open) return;
    position();
    panel.querySelector<HTMLElement>('input, button, a[href]')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener('resize', position);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      position();
    };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', onScroll, true);
    };
  });
</script>

<button type="button" bind:this={anchor} {disabled} class={className} aria-label={label} aria-expanded={open} popovertarget={uid}>
  {@render trigger()}
</button>
<div
  bind:this={panel}
  id={uid}
  class="project-popover"
  class:project-picker={above}
  popover="auto"
  role="dialog"
  aria-label={label}
  tabindex="-1"
  ontoggle={(event) => (open = event.newState === 'open')}
  onkeydown={(event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}
>
  {@render children(close)}
</div>
