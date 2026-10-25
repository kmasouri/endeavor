<script lang="ts">
  import { api, type Connection } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';
  import EnableButton from './EnableButton.svelte';

  let props: { connection: Connection; onChanged: () => void } = $props();
  let c = $derived(props.connection);
  let credential = $state('');
  let discovered = $state<{ name: string; description: string }[] | null>(null);
  let allowedTools = $state<string[] | null>(null);
  let approvalTools = $state<string[] | null>(null);
  const action = createAction();
  const visibleTools = $derived([
    ...(discovered ?? []),
    ...(c.allowedTools ?? [])
      .filter((name) => !discovered?.some((tool) => tool.name === name))
      .map((name) => ({
        name,
        description: 'Previously allowed; currently unavailable from discovery.'
      }))
  ]);

  function discover() {
    void action.run(async () => {
      discovered = await api.post(`/connections/${c.id}/tools`, {});
    });
  }

  function toggleAllowed(name: string, checked: boolean) {
    const selected = allowedTools ?? c.allowedTools ?? [];
    allowedTools = checked ? [...selected, name] : selected.filter((value) => value !== name);
    if (checked) {
      approvalTools = [...new Set([...(approvalTools ?? c.approvalTools ?? []), name])];
    }
  }

  function toggleApproval(name: string, checked: boolean) {
    const selected = approvalTools ?? c.approvalTools ?? [];
    approvalTools = checked ? [...selected, name] : selected.filter((value) => value !== name);
  }

  function saveTools() {
    void action
      .run(() => api.patch(`/connections/${c.id}`, {
        allowedTools: allowedTools ?? c.allowedTools ?? [],
        approvalTools: approvalTools ?? c.approvalTools ?? []
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
      .run(() => api.patch(`/connections/${c.id}`, { credential: value }))
      .then((ok) => ok && ((credential = ''), props.onChanged()));
</script>

<li>
  <div class="row">
    <span class="grow">
      <strong>{c.name}</strong>
      {#if c.disabledAt}<span class="badge">disabled</span>{/if}
      <span class="badge">{c.hasCredential ? 'credential saved' : 'no credential'}</span>
      <div class="muted small">{c.description} · {c.baseUrl}</div>
      <div class="muted small">
        {#if c.kind === 'mcp'}
          MCP · Allowed tools: {(c.allowedTools ?? []).join(', ') || 'none'}
          · needs approval: {(c.approvalTools ?? []).join(', ') || 'none'}
        {:else}
          HTTP API · Allowed: {c.allowedMethods.join(', ')} on {c.allowedPathPrefixes.join(', ')}
          {#if c.approvalMethods.length > 0}
            {` · needs approval: ${c.approvalMethods.join(', ')}`}
          {/if}
        {/if}
      </div>
    </span>
    <EnableButton
      path={`/connections/${c.id}`}
      disabled={Boolean(c.disabledAt)}
      onChanged={props.onChanged}
    />
  </div>

  {#if c.kind === 'mcp'}
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
                checked={(allowedTools ?? c.allowedTools ?? []).includes(tool.name)}
                onchange={(event) => toggleAllowed(tool.name, event.currentTarget.checked)}
              />
              <span>Allowed</span>
            </label>
            <label class="check">
              <input
                type="checkbox"
                disabled={!(allowedTools ?? c.allowedTools ?? []).includes(tool.name)}
                checked={(approvalTools ?? c.approvalTools ?? []).includes(tool.name)}
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
        placeholder={`New value for the ${c.authHeader} header`}
      />
      <button disabled={action.busy || !credential}>Replace</button>
      {#if c.hasCredential}
        <button type="button" class="secondary" disabled={action.busy} onclick={() => setSecret(null)}>
          Remove
        </button>
      {/if}
    </form>
    <ErrorNote error={action.error} />
  </details>
</li>
