<script lang="ts">
  import { onMount } from 'svelte';
  import { api, HTTP_METHODS, type Connection, type HttpMethod } from '../api';
  import CheckGroup from '../CheckGroup.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import PageHeader from '../PageHeader.svelte';
  import './creation.css';
  import { createAction, go } from '../state.svelte';

  const methodOptions = HTTP_METHODS.map((method) => ({ value: method, label: method }));

  const example = new URLSearchParams(window.location.hash.split('?')[1]).get('example');
  const notion = example === 'notion';
  const github = example === 'github';
  const executor = example === 'executor';
  let kind = $state<'http' | 'mcp'>(notion || github || executor ? 'mcp' : 'http');
  let authMethod = $state<'none' | 'header' | 'oauth'>(notion ? 'oauth' : 'header');
  let tools = $state('');
  let freeTools = $state('');
  const names = (text: string) =>
    text.split(/[\n,]/).map((name) => name.trim()).filter(Boolean);
  let name = $state(notion ? 'Notion' : github ? 'GitHub' : executor ? 'Isolated execution' : '');
  let description = $state(notion ? 'Search and read Notion documentation.' : github ? 'Read repositories and collaborate on pull requests.' : executor ? 'Edit task checkouts and run builds and tests in isolated containers.' : '');
  let discoverable = $state(false);
  let baseUrl = $state(notion ? 'https://mcp.notion.com/mcp' : github ? 'https://api.githubcopilot.com/mcp/' : executor ? 'http://executor:3200/mcp' : '');
  let authHeader = $state('Authorization');
  let credential = $state('');
  let allowedMethods = $state<HttpMethod[]>(['GET']);
  let prefixes = $state('/');
  let approvalMethods = $state<HttpMethod[]>(['POST', 'PUT', 'PATCH', 'DELETE']);
  const action = createAction();
  let active = true;
  onMount(() => () => { active = false; });
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(async () => {
        const useOAuth = kind === 'mcp' && authMethod === 'oauth';
        const connection = await api.post<Connection>('/connections', {
          name,
          description,
          baseUrl,
          discoverable,
          authMethod: kind === 'http' && authMethod === 'oauth' ? 'none' : authMethod,
          ...(authMethod === 'header' && { authHeader, ...(credential && { credential }) }),
          ...(kind === 'mcp'
            ? {
                kind,
                allowedTools: names(tools),
                approvalTools: names(tools).filter((name) => !names(freeTools).includes(name))
              }
            : {
                allowedMethods,
                allowedPathPrefixes: names(prefixes),
                approvalMethods: approvalMethods.filter((method) => allowedMethods.includes(method))
              })
        });
        if (!active) return;
        if (useOAuth) go(`/connections/${connection.id}?signIn=1`);
        else go('/connections');
      });
  };
</script>

<div class="creation-page">
  <a class="creation-back" href="#/connections">← Connections</a>
  <PageHeader
    title="New connection"
    subtitle="Connect an HTTP API or MCP server and choose what agents can call."
  />

  <form onsubmit={create} class="creation-form">
    <fieldset class="stack">
      <legend>Profile</legend>
      <p class="caption">Examples: <a href="#/connections/new?example=notion">Notion</a> · <a href="#/catalogs/connections/new?example=github">GitHub MCP</a> · <a href="#/catalogs/connections/new?example=executor">Isolated execution</a></p>
      <label>
        Connection type
        <select bind:value={kind} onchange={(event) => { if (event.currentTarget.value === 'http' && authMethod === 'oauth') authMethod = 'none'; }}>
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
      <label class="check">
        <input type="checkbox" bind:checked={discoverable} />
        Agents can find this and ask for access. Finding it grants nothing.
      </label>
    </fieldset>
    <fieldset class="stack">
      <legend>Authentication</legend>
      <label>
        Authentication method
        <select bind:value={authMethod}>
          <option value="none">No authentication</option>
          <option value="header">API key / token</option>
          {#if kind === 'mcp'}<option value="oauth">OAuth sign-in</option>{/if}
        </select>
      </label>
      {#if authMethod === 'oauth'}
        <Hint>You’ll sign in through the service after creating this connection. No API key is needed.</Hint>
      {:else if authMethod === 'header'}
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
      {#if github}
        <Hint>Use a GitHub personal access token as Bearer …, with access to the selected repositories. GitHub sign-in requires a registered GitHub app; generic OAuth sign-in does not support it yet. Discover and allow tools after saving. Writes require approval by default.</Hint>
      {:else if executor}
        <Hint>Use the execution service credential as Bearer …. The execution service must be running. After saving, discover tools and select this connection in the agent configuration.</Hint>
      {/if}
      {/if}
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
              options={methodOptions.filter((option) => allowedMethods.includes(option.value))}
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
      <a href="#/connections">Cancel</a>
      <button disabled={action.busy || !name.trim() || !description.trim() || !baseUrl.trim()}>{kind === 'mcp' && authMethod === 'oauth' ? 'Create and sign in' : 'Create connection'}</button>
    </div>
  </form>
</div>
