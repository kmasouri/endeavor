<script lang="ts">
  let {
    error
  }: {
    error: string | null | undefined;
  } = $props();
</script>

{#if error}
  <p class="error" role="alert">
    {error}
  </p>
{/if}
