<script lang="ts">
  import type { AgentAppearance } from './api';
  import Icon from './Icon.svelte';
  let {
    name,
    id = name,
    agent = false,
    size = 'md',
    appearance
  }: {
    name: string;
    id?: string;
    agent?: boolean;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    appearance?: AgentAppearance | null;
  } = $props();
  let tint = $derived(
    1 + (Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % (agent ? 3 : 4))
  );
  let color = $derived(
    agent && appearance?.avatarColor
      ? { lime: 1, sky: 2, teal: 3 }[appearance.avatarColor]
      : tint
  );
  let icon = $derived(appearance?.avatarIcon ?? (tint === 1 ? 'search' : tint === 2 ? 'check' : 'agents'));
</script>

<span
  class={`avatar avatar-${size}`}
  style={`--avatar-bg: var(--${agent ? 'agent' : 'person'}-${color}-bg); --avatar-ink: var(--${agent ? 'agent' : 'person'}-${color}-ink)`}
  role={agent ? 'img' : undefined}
  aria-label={agent ? `${name} · agent` : undefined}
  title={`${name}${agent ? ' · agent' : ''}`}
>
  {#if agent}<Icon name={icon} size={16} />{:else}{name.slice(0, 1).toUpperCase()}{/if}
  {#if agent}<span class="agent-badge" aria-hidden="true"
      ><svg viewBox="0 0 24 24"
        ><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" /></svg
      ></span
    >{/if}
</span>
