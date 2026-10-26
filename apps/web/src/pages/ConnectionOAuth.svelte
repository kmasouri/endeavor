<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Connection } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  let { connection }: { connection: Connection } = $props();
  let status = $state('');
  let expiresAt = $state<string | null>(null);
  const action = createAction();
  let active = true;
  async function refresh() {
    const value = await api.get<{ status: string; expiresAt: string | null }>(`/connections/${connection.id}/oauth`);
    if (active) { status = value.status; expiresAt = value.expiresAt; }
  }
  onMount(() => {
    void action.run(refresh);
    return () => { active = false; };
  });
  function connect() {
    void action.run(async () => {
      const result = await api.post<{ authorizationUrl: string }>(`/connections/${connection.id}/oauth/connect`);
      if (active) window.location.assign(result.authorizationUrl);
    });
  }
  function disconnect() {
    void action.run(async () => {
      await api.post(`/connections/${connection.id}/oauth/disconnect`);
      await refresh();
    });
  }
</script>

<details>
  <summary>Sign in with OAuth</summary>
  <div class="stack">
    <p class="muted small" role="status">
      {#if status === 'connected'}Signed in{#if expiresAt}. Tokens refresh automatically when needed.{/if}
      {:else if status === 'pending'}Sign-in pending. Complete consent or start again.
      {:else if status === 'reconnect_required'}Sign-in required. Reconnect to continue.
      {:else if status === 'disconnected'}Disconnected.
      {:else}Use this for services that require browser sign-in.{/if}
    </p>
    <p class="muted small">This is a shared connection. Agents granted it use the account you sign in with. The service will show what you authorize. Signing in does not enable tools or grant agent access.</p>
    <div class="row wrap">
      <button type="button" class="secondary" disabled={action.busy || Boolean(connection.disabledAt)} onclick={connect}>
        {status === 'connected' || status === 'reconnect_required' || status === 'pending' ? 'Reconnect' : 'Sign in'}
      </button>
      <button type="button" class="secondary" disabled={action.busy} onclick={() => void action.run(refresh)}>Refresh status</button>
      {#if status && status !== 'header' && status !== 'disconnected'}
        <button type="button" class="secondary" disabled={action.busy} onclick={disconnect}>Disconnect</button>
      {/if}
    </div>
    <ErrorNote error={action.error} />
  </div>
</details>
