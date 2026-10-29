<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { api, HTTP_METHODS, type Connection, type HttpMethod } from '../api';
  import { authenticationMethod } from '../connection-auth';
  import CheckGroup from '../CheckGroup.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction } from '../state.svelte';

  let { connection, onSaved, onDiscard, onChanged }: {
    connection: Connection;
    onSaved: () => Promise<void>;
    onDiscard: () => Promise<void>;
    onChanged: () => Promise<boolean>;
  } = $props();
  // Keep the draft stable when disconnecting reloads the saved connection.
  const original = untrack(() => connection);
  let name = $state(original.name);
  let description = $state(original.description);
  let baseUrl = $state(original.baseUrl);
  let authMethod = $state(authenticationMethod(original));
  let authHeader = $state(original.authHeader);
  let allowedMethods = $state<HttpMethod[]>([...(original.allowedMethods ?? [])]);
  let approvalMethods = $state<HttpMethod[]>([...(original.approvalMethods ?? [])]);
  let prefixes = $state((original.allowedPathPrefixes ?? []).join('\n'));
  let disconnected = $state(false);
  let nameInput: HTMLInputElement;
  const action = createAction();
  const disconnectAction = createAction();
  const busy = $derived(action.busy || disconnectAction.busy);
  const methodOptions = HTTP_METHODS.map((method) => ({ value: method, label: method }));
  const paths = $derived(prefixes.split(/[\n,]/).map((path) => path.trim()).filter(Boolean));
  const changes = $derived.by(() => {
    const result: Record<string, unknown> = {};
    if (name.trim() !== original.name) result.name = name.trim();
    if (description.trim() !== original.description) result.description = description.trim();
    if (baseUrl.trim() !== original.baseUrl) result.baseUrl = baseUrl.trim();
    if (authMethod !== authenticationMethod(original)) result.authMethod = authMethod;
    if (authMethod === 'header' && authHeader.trim() !== original.authHeader)
      result.authHeader = authHeader.trim();
    if (original.kind !== 'mcp') {
      if (JSON.stringify(allowedMethods) !== JSON.stringify(original.allowedMethods))
        result.allowedMethods = allowedMethods;
      if (JSON.stringify(paths) !== JSON.stringify(original.allowedPathPrefixes))
        result.allowedPathPrefixes = paths;
      if (JSON.stringify(approvalMethods) !== JSON.stringify(original.approvalMethods))
        result.approvalMethods = approvalMethods;
    }
    return result;
  });
  const needsDisconnect = $derived(authenticationMethod(original) === 'oauth' && !disconnected &&
    ('baseUrl' in changes || 'authMethod' in changes || 'authHeader' in changes));
  const invalid = $derived(!name.trim() || !description.trim() || !baseUrl.trim() ||
    (authMethod === 'header' && !authHeader.trim()) ||
    (original.kind !== 'mcp' && (!allowedMethods.length || !paths.length)));

  onMount(() => nameInput.focus());
  function disconnect() {
    void disconnectAction.run(async () => {
      await api.post(`/connections/${original.id}/oauth/disconnect`);
      disconnected = true;
      await onChanged();
    });
  }
  function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy || invalid || needsDisconnect || !Object.keys(changes).length) return;
    void action.run(async () => {
      await api.patch(`/connections/${original.id}`, changes);
      await onSaved();
    });
  }
</script>

<form class="stack" onsubmit={save} aria-label="Edit connection configuration">
  <fieldset class="stack" disabled={busy}>
    <legend>Profile</legend>
    <div class="grid2">
      <label>Name<input bind:this={nameInput} bind:value={name} maxlength="80" required /></label>
      <label>{original.kind === 'mcp' ? 'MCP endpoint URL' : 'Base URL'}<input type="url" bind:value={baseUrl} required /></label>
    </div>
    <label>Description<input bind:value={description} required /></label>
  </fieldset>
  <fieldset class="stack" disabled={busy}>
    <legend>Authentication</legend>
    <label>Authentication method
      <select bind:value={authMethod}>
        <option value="none">No authentication</option>
        <option value="header">API key / token</option>
        {#if original.kind === 'mcp'}<option value="oauth">OAuth sign-in</option>{/if}
      </select>
    </label>
    {#if authMethod === 'header'}
      <label>Credential header<input bind:value={authHeader} maxlength="100" required /></label>
      <Hint>The saved credential stays hidden and unchanged. Save configuration before replacing or removing it.</Hint>
    {/if}
    {#if authMethod !== authenticationMethod(original) && original.hasCredential && authMethod !== 'header'}
      <Hint>Saving this authentication method removes the saved header credential.</Hint>
    {/if}
    {#if authMethod === 'oauth'}
      <Hint>Sign in through the connection’s authentication controls after saving.</Hint>
    {/if}
  </fieldset>
  {#if needsDisconnect}
    <div class="stack">
      <p class="muted small">Disconnect OAuth before saving endpoint or authentication changes. Sign in again after saving if you keep OAuth. Disconnecting takes effect immediately, even if you discard these edits.</p>
      <button type="button" class="secondary" disabled={busy} onclick={disconnect}>Disconnect OAuth</button>
    </div>
  {/if}
  <ErrorNote error={disconnectAction.error} />
  {#if original.kind !== 'mcp'}
    <fieldset class="stack" disabled={busy}>
      <legend>Access</legend>
      <div class="grid2">
        <fieldset class="method-group">
          <legend>Allowed methods</legend>
          <CheckGroup options={methodOptions} selected={allowedMethods} onChange={(value) => {
            // Newly allowed methods require approval until explicitly changed.
            approvalMethods = [...new Set([...approvalMethods, ...value.filter((method) => !allowedMethods.includes(method))])];
            allowedMethods = value;
          }} />
        </fieldset>
        <fieldset class="method-group">
          <legend>Need a person's approval</legend>
          <CheckGroup options={methodOptions.filter((option) => allowedMethods.includes(option.value))}
            selected={approvalMethods} onChange={(value) => (approvalMethods = value)} />
        </fieldset>
      </div>
      <label>Allowed paths
        <Hint>Path prefixes agents may call, one per line, like /v1/issues.</Hint>
        <textarea bind:value={prefixes} rows={3} required></textarea>
      </label>
    </fieldset>
  {/if}
  <p class="muted small">Changes apply to this shared connection for agents already granted access.</p>
  <ErrorNote error={action.error} />
  <div class="savebar">
    <button type="button" class="secondary" disabled={busy} onclick={() => void onDiscard()}>Discard</button>
    <button disabled={busy || invalid || needsDisconnect || !Object.keys(changes).length}>{action.busy ? 'Saving…' : 'Save changes'}</button>
  </div>
</form>
