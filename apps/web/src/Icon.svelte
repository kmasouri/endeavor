<script lang="ts">
  let { name, size = 18 }: { name: string; size?: number } = $props();
  const paths: Record<string, string> = {
    conversations: 'M4 5h16v11H8l-4 4z',
    approvals: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z',
    schedules: 'M12 8v4l3 2',
    agents: 'M5 7h14v11H5zM12 4v3M9 12h.01M15 12h.01',
    catalogs: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14v6M14 17h6',
    setup: 'M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2',
    panel: 'M3 4h18v16H3zM9 4v16',
    plus: 'M12 5v14M5 12h14',
    switch: 'M4 7h16m-4-4l4 4-4 4M20 17H4m4-4l-4 4 4 4',
    close: 'M6 6l12 12M18 6L6 18',
    send: 'M5 12h14M13 6l6 6-6 6',
    reply: 'M9 5l-6 6 6 6M3 11h11a6 6 0 016 6',
    copy: 'M9 9h11v12H9zM15 9V3H3v12h6',
    history: 'M4 6h16M4 12h16M4 18h10',
    attach: 'M8 14l7-7a3 3 0 014 4L9 21a5 5 0 01-7-7L13 3',
    file: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
    check: 'M5 12l4 4L19 6',
    moon: 'M20 15a8 8 0 01-11-11 9 9 0 1011 11',
    search: 'M20 20l-5-5',
    work: 'M4 7h16v14H4zM8 7V3h8v4'
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'schedules'}<circle cx="12" cy="12" r="8" />{/if}
  {#if name === 'setup'}<circle cx="12" cy="12" r="3" />{/if}
  {#if name === 'search'}<circle cx="10" cy="10" r="6" />{/if}
  <path d={paths[name] ?? paths.agents} />
</svg>
