<script lang="ts">
  import Icon from './Icon.svelte';
  let {
    name,
    id = name,
    agent = false,
    size = 'md'
  }: { name: string; id?: string; agent?: boolean; size?: 'sm' | 'md' | 'lg' | 'xl' } = $props();
  let tint = $derived(
    1 + (Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % (agent ? 3 : 4))
  );
</script>

<span
  class={`avatar avatar-${size}`}
  style={`--avatar-bg: var(--${agent ? 'agent' : 'person'}-${tint}-bg); --avatar-ink: var(--${agent ? 'agent' : 'person'}-${tint}-ink)`}
  role={agent ? 'img' : undefined}
  aria-label={agent ? `${name} · agent` : undefined}
  title={`${name}${agent ? ' · agent' : ''}`}
>
  {#if agent}<Icon name="agents" size={16} />{:else}{name.slice(0, 1).toUpperCase()}{/if}
</span>
