<script lang="ts">
  let { current }: { current: 'plugins' | 'skills' | 'connections' } = $props();
  const views = [
    { path: 'plugins', title: 'Plugins' },
    { path: 'skills', title: 'Skills' },
    { path: 'connections', title: 'Connections' }
  ] as const;
</script>

<nav aria-label="Catalog views">
  {#each views as view (view.path)}
    <a href={`#/${view.path}`} aria-label={`${view.title} catalog`}
      aria-current={current === view.path ? 'page' : undefined}>{view.title}</a>
  {/each}
</nav>

<style>
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--border-100);
  }

  a {
    display: inline-flex;
    align-items: center;
    min-height: var(--touch);
    padding-inline: 12px;
    color: var(--text-300);
    text-decoration: none;
    border-bottom: 2px solid transparent;
  }

  a:hover, a[aria-current='page'] {
    color: var(--text-100);
  }

  a[aria-current='page'] {
    border-bottom-color: var(--accent);
  }
</style>
