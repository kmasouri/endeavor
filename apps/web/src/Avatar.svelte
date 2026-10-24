<script lang="ts">
  import Icon from './Icon.svelte';
  let {
    name,
    id = name,
    agent = false,
    size = 'md'
  }: { name: string; id?: string; agent?: boolean; size?: 'sm' | 'md' | 'lg' } = $props();
  let tint = $derived(
    1 + (Array.from(id).reduce((n, c) => n + c.charCodeAt(0), 0) % (agent ? 3 : 4))
  );
</script>

<span
  class={`avatar avatar-${size}`}
  style={`--avatar-bg: var(--${agent ? 'agent' : 'person'}-${tint}-bg); --avatar-ink: var(--${agent ? 'agent' : 'person'}-${tint}-ink)`}
  title={`${name}${agent ? ' · agent' : ''}`}
>
  {#if agent}<Icon
      name={tint === 1 ? 'search' : tint === 2 ? 'check' : 'agents'}
      size={16}
    />{:else}{name.slice(0, 1).toUpperCase()}{/if}
  {#if agent}<span class="spark" aria-label="Agent"
      ><svg viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" /></svg
      ></span
    >{/if}
</span>
