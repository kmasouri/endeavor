<script lang="ts">
  import { api, HTTP_METHODS, type HttpMethod } from '../api';
  import CheckGroup from '../CheckGroup.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import PageHeader from '../PageHeader.svelte';
  import './creation.css';
  import { createAction, go } from '../state.svelte';

  const methodOptions = HTTP_METHODS.map((method) => ({ value: method, label: method }));

  let kind = $state<'http' | 'mcp'>('http');
  let tools = $state('');
  let freeTools = $state('');
  const names = (text: string) =>
    text.split(/[\n,]/).map((name) => name.trim()).filter(Boolean);
  let name = $state('');
  let description = $state('');
  let baseUrl = $state('');
  let authHeader = $state('Authorization');
  let credential = $state('');
  let allowedMethods = $state<HttpMethod[]>(['GET']);
  let prefixes = $state('/');
  let approvalMethods = $state<HttpMethod[]>(['POST', 'PUT', 'PATCH', 'DELETE']);
  const action = createAction();
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() =>
        api.post('/connections', {
          name,
          description,
          baseUrl,
          authHeader,
          ...(credential && { credential }),
          ...(kind === 'mcp'
            ? {
                kind,
                allowedTools: names(tools),
                approvalTools: names(tools).filter((name) => !names(freeTools).includes(name))
              }
            : {
                allowedMethods,
                allowedPathPrefixes: names(prefixes),
                approvalMethods: approvalMethods.filter((m) => allowedMethods.includes(m))
              })
        })
      )
      .then((ok) => {
        if (ok) {
          go('/catalogs?tab=connections');
        }
      });
  };
</script>

<div class="creation-page">
  <a class="creation-back" href="#/catalogs?tab=connections">← Connections</a>
  <PageHeader
    title="New connection"
    subtitle="Connect an HTTP API or MCP server and choose what agents can call."
  />

  <form onsubmit={create} class="creation-form">
    <fieldset class="stack">
      <legend>Profile</legend>
      <label>
        Connection type
        <select bind:value={kind}>
          <option value="http">HTTP API</option>
          <option value="mcp">MCP server</option>
        </select>
      </label>
      <div class="grid2">
        <label>
          Name

          <input bind:value={name} required />
        </label>

        <label>
          {kind === 'mcp' ? 'MCP endpoint URL' : 'Base URL'}

          <input type="url" bind:value={baseUrl} placeholder="https://api.example.com" required />
        </label>
      </div>

      <label>
        Description

        <input bind:value={description} required />
      </label>
    </fieldset>
    <fieldset class="stack">
      <legend>Authentication</legend>
      <div class="grid2">
        <label>
          Credential header

          <input bind:value={authHeader} />
        </label>

        <label>
          Credential

          <input type="password" autocomplete="off" bind:value={credential} placeholder="Bearer …" />
        </label>
      </div>

      <Hint>The credential is encrypted when saved, and never shown again, not even to you.</Hint>
    </fieldset>
    <fieldset class="stack">
      <legend>Access</legend>
      {#if kind === 'http'}
        <div class="grid2">
          <fieldset class="method-group">
            <legend>Allowed methods</legend>
            <CheckGroup
              options={methodOptions}
              selected={allowedMethods}
              onChange={(value) => (allowedMethods = value)}
            />
          </fieldset>
          <fieldset class="method-group">
            <legend>Need a person's approval</legend>
            <CheckGroup
              options={methodOptions.filter((o) => allowedMethods.includes(o.value))}
              selected={approvalMethods}
              onChange={(value) => (approvalMethods = value)}
            />
          </fieldset>
        </div>
        <label>
          Allowed paths
          <Hint>Path prefixes agents may call, one per line, like /v1/issues.</Hint>
          <textarea bind:value={prefixes} rows={2}></textarea>
        </label>
      {:else}
        <label>
          Allowed tools
          <Hint>Exact MCP tool names, one per line. You can discover tools after saving.</Hint>
          <textarea bind:value={tools} rows={3}></textarea>
        </label>
        <label>
          Tools that can run without approval
          <Hint>
            Leave empty to require approval for every tool. Only include allowed tools you trust to
            run unattended.
          </Hint>
          <textarea bind:value={freeTools} rows={2}></textarea>
        </label>
      {/if}
    </fieldset>
    <ErrorNote error={action.error} />
    <div class="savebar">
      <a href="#/catalogs?tab=connections">Cancel</a>
      <button disabled={action.busy || !name.trim() || !description.trim() || !baseUrl.trim()}>Create connection</button>
    </div>
  </form>
</div>
