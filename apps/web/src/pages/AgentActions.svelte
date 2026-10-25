<script lang="ts">
  let { disabled, busy, onToggle, onDelete }: {
    disabled: boolean;
    busy: boolean;
    onToggle: () => void;
    onDelete: () => void;
  } = $props();
  let menu = $state<HTMLDetailsElement>();
  let trigger = $state<HTMLElement>();
  const choose = (action: () => void) => {
    if (menu) menu.open = false;
    trigger?.focus();
    action();
  };
  const close = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && menu?.open) {
      event.preventDefault();
      menu.open = false;
      trigger?.focus();
    }
  };
</script>

<svelte:window onclick={(event) => {
  if (menu && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
}} onkeydown={close} />

<details class="agent-actions" bind:this={menu} onfocusout={(event) => {
  if (menu && event.relatedTarget instanceof Node && !menu.contains(event.relatedTarget)) menu.open = false;
}}>
  <summary class="secondary" bind:this={trigger}>Actions <span aria-hidden="true">▾</span></summary>
  <div class="agent-actions-list">
    <button disabled={busy} onclick={() => choose(onToggle)}>{disabled ? 'Enable agent' : 'Disable agent'}</button>
    <button class="agent-delete" disabled={busy} onclick={() => choose(onDelete)}>Delete agent</button>
  </div>
</details>
