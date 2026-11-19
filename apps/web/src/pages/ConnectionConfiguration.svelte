<script lang="ts">
  import { tick } from 'svelte';
  import { authenticationLabel } from '../connection-auth';
  import { api, type Connection } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';
  import DiscoverableToggle from './DiscoverableToggle.svelte';
  import EnableButton from './EnableButton.svelte';
  import ConnectionOAuth from './ConnectionOAuth.svelte';
  import ConnectionEditForm from './ConnectionEditForm.svelte';

  let props: { connection: Connection; onChanged: () => Promise<boolean>; startSignIn?: boolean } = $props();
  let connection = $derived(props.connection);
  let credential = $state('');
  let editing = $state(false);
  let editButton = $state<HTMLButtonElement>();
  async function closeEditor() {
    editing = false;
    await tick();
    editButton?.focus();
  }
  async function savedConfiguration() {
    if (!await props.onChanged()) throw new Error('Changes saved, but the connection could not be reloaded. Try saving again to refresh it.');
    discovered = null;
    allowedTools = null;
    approvalTools = null;
    await closeEditor();
  }
  let discovered = $state<{ name: string; description: string }[] | null>(null);
  let allowedTools = $state<string[] | null>(null);
  let approvalTools = $state<string[] | null>(null);
  const toolAction = createAction();
  const credentialAction = createAction();
  const busy = $derived(toolAction.busy || credentialAction.busy);
  const visibleTools = $derived([
    ...(discovered ?? []),
    ...(connection.allowedTools ?? [])
      .filter((name) => !discovered?.some((tool) => tool.name === name))
      .map((name) => ({
        name,
        description: 'Previously allowed; currently unavailable from discovery.'
      }))
  ]);

  function discover() {
    void toolAction.run(async () => {
      discovered = await api.post(`/connections/${connection.id}/tools`, {});
    });
  }

  function toggleAllowed(name: string, checked: boolean) {
    const selected = allowedTools ?? connection.allowedTools ?? [];
    allowedTools = checked ? [...selected, name] : selected.filter((value) => value !== name);
    if (checked) {
      approvalTools = [...new Set([...(approvalTools ?? connection.approvalTools ?? []), name])];
    }
  }

  function toggleApproval(name: string, checked: boolean) {
    const selected = approvalTools ?? connection.approvalTools ?? [];
    approvalTools = checked ? [...selected, name] : selected.filter((value) => value !== name);
  }

  function saveTools() {
    void toolAction
      .run(() => api.patch(`/connections/${connection.id}`, {
        allowedTools: allowedTools ?? connection.allowedTools ?? [],
        approvalTools: approvalTools ?? connection.approvalTools ?? []
      }))
      .then((ok) => {
        if (ok) {
          allowedTools = null;
          approvalTools = null;
          props.onChanged();
        }
      });
  }

  const setSecret = (value: string | null) =>
    void credentialAction
      .run(() => api.patch(`/connections/${connection.id}`, { credential: value }))
      .then((ok) => ok && ((credential = ''), props.onChanged()));
</script>

<div class="stack">
  <div class="row wrap">
    <div class="grow">
      <h2>Configuration</h2>
      <p class="muted small">{connection.kind === 'mcp' ? 'MCP server' : 'HTTP API'} · {authenticationLabel(connection)}</p>
    </div>
    {#if !editing}
      <button type="button" class="secondary" bind:this={editButton} disabled={busy} onclick={() => { editing = true; }}>Edit configuration</button>
    {/if}
    <EnableButton
      path={`/connections/${connection.id}`}
      disabled={Boolean(connection.disabledAt)}
      onChanged={props.onChanged}
    />
  </div>
  {#if editing}
    <ConnectionEditForm {connection} onDiscard={closeEditor} onSaved={savedConfiguration} onChanged={props.onChanged} />
  {:else}
  <DiscoverableToggle
    path={`/connections/${connection.id}`}
    discoverable={connection.discoverable}
    onChanged={props.onChanged}
  />

  {#if connection.kind === 'mcp'}
    <ConnectionOAuth {connection} onChanged={props.onChanged} startSignIn={props.startSignIn} />
  {/if}
  <fieldset class="stack">
    <legend>Access</legend>
    <div><span class="muted small">Endpoint</span><p>{connection.baseUrl}</p></div>
    {#if connection.kind === 'mcp'}
      <p class="muted small">Allowed tools: {(connection.allowedTools ?? []).join(', ') || 'none'}. Needs approval: {(connection.approvalTools ?? []).join(', ') || 'none'}.</p>
    {:else}
      <p class="muted small">Allowed methods: {connection.allowedMethods.join(', ')}. Paths: {connection.allowedPathPrefixes.join(', ')}. Needs approval: {connection.approvalMethods.join(', ') || 'none'}.</p>
    {/if}
    <p class="muted small">Access is granted separately on each agent. Credentials are encrypted and never shown again.</p>
  </fieldset>
  {#if connection.kind === 'mcp'}
    <details>
      <summary>Discover and manage tools</summary>
      <button type="button" class="secondary" disabled={busy} onclick={discover}>
        Discover tools
      </button>
      {#if discovered}
        <p class="muted small">Enable tools explicitly. Newly selected tools require approval.</p>
        {#each visibleTools as tool (tool.name)}
          <fieldset class="stack">
            <legend>{tool.name}</legend>
            <span class="muted small">{tool.description}</span>
            <label class="check">
              <input
                type="checkbox"
                checked={(allowedTools ?? connection.allowedTools ?? []).includes(tool.name)}
                onchange={(event) => toggleAllowed(tool.name, event.currentTarget.checked)}
              />
              <span>Allowed</span>
            </label>
            <label class="check">
              <input
                type="checkbox"
                disabled={!(allowedTools ?? connection.allowedTools ?? []).includes(tool.name)}
                checked={(approvalTools ?? connection.approvalTools ?? []).includes(tool.name)}
                onchange={(event) => toggleApproval(tool.name, event.currentTarget.checked)}
              />
              <span>Needs approval</span>
            </label>
          </fieldset>
        {/each}
        <button disabled={busy} onclick={saveTools}>Save tool access</button>
      {/if}
      <ErrorNote error={toolAction.error} />
    </details>
  {/if}

  <details>
    <summary>Replace or remove the credential</summary>
    <form
      class="row wrap credential-form"
      onsubmit={(event) => {
        event.preventDefault();
        setSecret(credential);
      }}
    >
      <input
        class="grow"
        aria-label="New credential"
        type="password"
        autocomplete="off"
        bind:value={credential}
        placeholder={`New value for the ${connection.authHeader} header`}
      />
      <button disabled={busy || !credential}>Replace</button>
      {#if connection.hasCredential}
        <button type="button" class="secondary" disabled={busy} onclick={() => setSecret(null)}>
          Remove
        </button>
      {/if}
    </form>
    <ErrorNote error={credentialAction.error} />
  </details>
  {/if}
</div>

<style>
  .credential-form input {
    flex: 1 1 240px;
    min-width: 0;
  }
</style>
