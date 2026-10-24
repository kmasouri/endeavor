<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, subtitle, actions }: { title: string; subtitle: string; actions?: Snippet } =
    $props();
</script>

<header class="page-header">
  <div class="heading">
    <h1 {title}>{title}</h1>
    <p title={subtitle}>{subtitle}</p>
  </div>
  {#if actions}<div class="header-actions">{@render actions()}</div>{/if}
</header>
