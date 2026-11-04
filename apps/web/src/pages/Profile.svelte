<script lang="ts">
  import { untrack } from 'svelte';
  import {
    type Agent, type AgentAppearance, AGENT_AVATAR_COLORS, AGENT_AVATAR_ICONS, api
  } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Avatar from '../Avatar.svelte';
  import Icon from '../Icon.svelte';
  import Hint from '../Hint.svelte';
  import { createAction } from '../state.svelte';

  let {
    agent,
    onSaved,
    onDiscard
  }: {
    agent: Agent;
    onSaved: () => void;
    onDiscard: () => void;
  } = $props();
  let name = $state(untrack(() => agent.name));
  let purpose = $state(untrack(() => agent.purpose));
  let produces = $state(untrack(() => agent.produces ?? ''));
  let needs = $state(untrack(() => agent.needs ?? ''));
  let avatarColor = $state<AgentAppearance['avatarColor']>(untrack(() => agent.avatarColor ?? null));
  let avatarIcon = $state<AgentAppearance['avatarIcon']>(untrack(() => agent.avatarIcon ?? null));
  const colors = { lime: 'Lime', sky: 'Sky', teal: 'Teal' };
  const icons = {
    agents: 'Robot', search: 'Search', check: 'Check', file: 'Document', work: 'Briefcase',
    connections: 'Link', approvals: 'Shield', catalogs: 'Grid', setup: 'Sun', schedules: 'Clock'
  };
  const action = createAction();
  let changed = $derived(
    name !== agent.name || purpose !== agent.purpose ||
    produces !== (agent.produces ?? '') || needs !== (agent.needs ?? '') ||
    avatarColor !== (agent.avatarColor ?? null) || avatarIcon !== (agent.avatarIcon ?? null)
  );
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.patch(`/agents/${agent.id}`, { name, purpose, produces: produces.trim() || null, needs: needs.trim() || null, avatarColor, avatarIcon }))
      .then((ok) => ok && onSaved());
  };
</script>

<form onsubmit={save} class="panel stack">
  <h2>Profile</h2>

  <Hint>Profile changes aren't versioned. Changes show up everywhere at once.</Hint>

  <label>
    Name

    <input bind:value={name} disabled={action.busy} maxlength={80} required />
  </label>

  <label>
    Purpose

    <input bind:value={purpose} disabled={action.busy} required />
  </label>

  <label>
    Produces
    <textarea bind:value={produces} disabled={action.busy} maxlength={500} rows={2} placeholder="A brief with sources, a patch, or test results"></textarea>
    <small class="muted">Optional. What this agent hands back. Up to 500 characters.</small>
  </label>
  <label>
    Needs
    <textarea bind:value={needs} disabled={action.busy} maxlength={500} rows={2} placeholder="A question, source documents, or steps to reproduce"></textarea>
    <small class="muted">Optional. The input this agent needs. Up to 500 characters.</small>
  </label>

  <fieldset disabled={action.busy} class="appearance-editor">
    <legend>Appearance</legend>
    <div class="row appearance-preview" aria-label="Avatar preview">
      <Avatar {name} id={agent.id} agent size="xl" appearance={{ avatarColor, avatarIcon }} />
      <span>{name || 'Agent'}</span>
    </div>
    <fieldset class="appearance-options">
      <legend>Color</legend>
      <label><input type="radio" name="avatar-color" bind:group={avatarColor} value={null} />Automatic</label>
      {#each AGENT_AVATAR_COLORS as color, i (color)}
        <label><input type="radio" name="avatar-color" bind:group={avatarColor} value={color} />
          <span class="appearance-swatch" style={`--swatch: var(--agent-${i + 1}-bg); --mark: var(--agent-${i + 1}-ink)`} aria-hidden="true">●</span>{colors[color]}</label>
      {/each}
    </fieldset>
    <fieldset class="appearance-options">
      <legend>Icon</legend>
      <label><input type="radio" name="avatar-icon" bind:group={avatarIcon} value={null} />Automatic</label>
      {#each AGENT_AVATAR_ICONS as icon (icon)}
        <label><input type="radio" name="avatar-icon" bind:group={avatarIcon} value={icon} /><Icon name={icon} size={16} />{icons[icon]}</label>
      {/each}
    </fieldset>
    <button type="button" class="text-button" onclick={() => { avatarColor = null; avatarIcon = null; }}>Reset appearance</button>
  </fieldset>

  <div class="row wrap">
    <button disabled={action.busy || !changed}>{action.busy ? 'Saving…' : 'Save profile'}</button>
    <button type="button" class="secondary" disabled={action.busy} onclick={onDiscard}>Discard changes</button>
  </div>

  <ErrorNote error={action.error} />
</form>
