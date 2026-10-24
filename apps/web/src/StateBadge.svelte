<script lang="ts">
  let {
    state,
    paused
  }: {
    state: string;
    paused?: boolean;
  } = $props();
</script>

<span class={`badge state-${state}`}>
  {state}
</span>

{#if paused}
  <span class="badge"> paused </span>
{/if}
