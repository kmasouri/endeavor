<script lang="ts">
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
  let matches = $derived(
    query.trim()
      ? options.filter(
          (item) =>
            !item.disabledAt &&
            !selected.includes(item.id) &&
            `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())
        )
      : []
  );
  let shown = $derived([...new Set([...original, ...selected])]);
  const add = (id: string) => {
    onChange([...selected, id]);
    query = '';
  };
</script>

<div class="agent-picker">
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
    bind:value={query}
  />
  {#if query.trim()}
    <div class="picker-results" aria-label={`${kind} matches`}>
      {#each matches.slice(0, 5) as item (item.id)}
        <button type="button" class="quiet picker-result" onclick={() => add(item.id)}
          ><span class="grow"><strong>{item.name}</strong><small>{item.description}</small></span
          ><span>Add</span></button
        >
      {:else}<p class="muted">No matching {kind}s.</p>{/each}
      <span class="caption muted">{matches.length} matches · showing up to 5</span>
    </div>
  {/if}
  <a class="caption" href={`#/catalogs?tab=${kind}s`}>Browse {kind}s</a>
</div>
