<script lang="ts">
  import { tick } from 'svelte';
  let {
    kind,
    options,
    selected,
    original = [],
    onChange
  }: {
    kind: 'skill' | 'connection';
    options: { id: string; name: string; description: string; disabledAt: string | null }[];
    selected: string[];
    original?: string[];
    onChange: (ids: string[]) => void;
  } = $props();
  let query = $state('');
  let open = $state(false);
  let pointing = false;
  let container: HTMLDivElement;
  let input: HTMLInputElement;
  let matches = $derived(
    options.filter(
      (item) =>
        !item.disabledAt &&
        !selected.includes(item.id) &&
        `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())
    )
  );
  const focusResult = async (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open = true;
    await tick();
    const buttons = container.querySelectorAll<HTMLButtonElement>('.picker-result');
    buttons[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus();
  };
  let shown = $derived([...new Set([...original, ...selected])]);
  const add = (id: string) => {
    onChange([...selected, id]);
    query = '';
    input.focus();
    open = true;
  };
</script>

<svelte:window
  onpointerdown={() => (pointing = true)}
  onpointercancel={() => (pointing = false)}
  onclick={(event) => {
    // Close after the click so removing the list cannot move its target before mouseup.
    if (!container.contains(event.target as Node)) open = false;
    pointing = false;
  }}
  onkeydown={(event) => {
    pointing = false;
    if (open && event.key === 'Escape' && container.contains(event.target as Node)) {
      event.preventDefault();
      input.focus();
      open = false;
    }
  }}
/>

<div
  class="agent-picker"
  bind:this={container}
  onfocusout={(event) => {
    if (!pointing && !container.contains(event.relatedTarget as Node | null)) open = false;
  }}
>
  {#if shown.length}
    <ul class="picked">
      {#each shown as id (id)}
        {@const item = options.find((item) => item.id === id)}
        {@const removed = !selected.includes(id)}
        <li class:removed>
          <div class="grow">
            {#if removed}<s>{item?.name ?? id}</s>{:else}<strong>{item?.name ?? id}</strong>{/if}
            {#if removed}<small>When you save, open tasks stop using it too</small>
            {:else if item?.disabledAt}<small>Disabled in the catalog</small>{/if}
          </div>
          <button
            type="button"
            class="quiet"
            aria-label={`${removed ? 'Undo removal of' : 'Remove'} ${item?.name ?? id}`}
            onclick={() =>
              removed ? add(id) : onChange(selected.filter((chosen) => chosen !== id))}
            >{removed ? 'Undo' : '×'}</button
          >
        </li>
      {/each}
    </ul>
  {:else}<p class="picked-empty muted">No {kind}s chosen.</p>{/if}
  <input
    type="search"
    aria-label={`Add ${kind}s`}
    placeholder={`Search to add ${kind}s…`}
    bind:this={input}
    onfocus={() => (open = true)}
    onclick={() => (open = true)}
    oninput={() => (open = true)}
    onkeydown={focusResult}
    bind:value={query}
  />
  {#if open}
    <div role="region" class="picker-results" aria-label={`${kind} matches`}>
      {#each matches.slice(0, 5) as item (item.id)}
        <button type="button" class="quiet picker-result" onclick={() => add(item.id)}
          ><span class="grow"><strong>{item.name}</strong><small>{item.description}</small></span
          ><span>Add</span></button
        >
      {:else}<p class="muted">
          {query.trim() ? `No matching ${kind}s.` : `No available ${kind}s to add.`}
        </p>{/each}
      <span class="caption muted">{matches.length} matches · showing up to 5</span>
    </div>
  {/if}
  <a class="caption" href={`#/catalogs?tab=${kind}s`}>Browse {kind}s</a>
</div>
