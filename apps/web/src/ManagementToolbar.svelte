<script lang="ts">
  import './management.css';
  let { name, filters, filter = $bindable('All'), search = $bindable('') }: {
    name: string; filters: string[]; filter?: string; search?: string;
  } = $props();
</script>
<div class="management-toolbar">
  <div class="list-filters" aria-label={`Filter ${name}`}>
    {#each filters as value (value)}
      <button aria-pressed={filter === value} onclick={() => (filter = value)}>{value}</button>
    {/each}
  </div>
  <input type="search" aria-label={`Search ${name}`} placeholder={`Search ${name}`} bind:value={search} />
</div>
