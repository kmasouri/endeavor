<script lang="ts">
  import { api, type Connection } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';
  import DiscoverableToggle from './DiscoverableToggle.svelte';
  import EnableButton from './EnableButton.svelte';

  let props: { connection: Connection; onChanged: () => void } = $props();
  let connection = $derived(props.connection);
  let credential = $state('');
  let discovered = $state<{ name: string; description: string }[] | null>(null);
  let allowedTools = $state<string[] | null>(null);
  let approvalTools = $state<string[] | null>(null);
  const action = createAction();
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
    void action.run(async () => {
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
    void action
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
    void action
      .run(() => api.patch(`/connections/${connection.id}`, { credential: value }))
      .then((ok) => ok && ((credential = ''), props.onChanged()));
</script>

<li>
  <div class="row">
    <span class="grow">
      <strong>{connection.name}</strong>
      {#if connection.disabledAt}<span class="badge">disabled</span>{/if}
      <span class="badge">{connection.hasCredential ? 'credential saved' : 'no credential'}</span>
      <div class="muted small">{connection.description} · {connection.baseUrl}</div>
      <div class="muted small">
        {#if connection.kind === 'mcp'}
          MCP · Allowed tools: {(connection.allowedTools ?? []).join(', ') || 'none'}
          · needs approval: {(connection.approvalTools ?? []).join(', ') || 'none'}
        {:else}
          HTTP API · Allowed: {connection.allowedMethods.join(', ')} on {connection.allowedPathPrefixes.join(', ')}
          {#if connection.approvalMethods.length > 0}
            {` · needs approval: ${connection.approvalMethods.join(', ')}`}
          {/if}
        {/if}
      </div>
      <DiscoverableToggle
        path={`/connections/${connection.id}`}
        discoverable={connection.discoverable}
        onChanged={props.onChanged}
      />
    </span>
    <EnableButton
      path={`/connections/${connection.id}`}
      disabled={Boolean(connection.disabledAt)}
      onChanged={props.onChanged}
    />
  </div>

  {#if connection.kind === 'mcp'}
    <details>
      <summary>Discover and manage tools</summary>
      <button type="button" class="secondary" disabled={action.busy} onclick={discover}>
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
        <button disabled={action.busy} onclick={saveTools}>Save tool access</button>
      {/if}
      <ErrorNote error={action.error} />
    </details>
  {/if}

  <details>
    <summary>Replace or remove the credential</summary>
    <form
      class="row"
      onsubmit={(event) => {
        event.preventDefault();
        setSecret(credential);
      }}
    >
      <input
        class="grow"
        type="password"
        autocomplete="off"
        bind:value={credential}
        placeholder={`New value for the ${connection.authHeader} header`}
      />
      <button disabled={action.busy || !credential}>Replace</button>
      {#if connection.hasCredential}
        <button type="button" class="secondary" disabled={action.busy} onclick={() => setSecret(null)}>
          Remove
        </button>
      {/if}
    </form>
    <ErrorNote error={action.error} />
  </details>
</li>
