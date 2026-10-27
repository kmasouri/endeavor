<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Connection } from '../api';
  import { authenticationMethod, isAuthenticated } from '../connection-auth';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  let { connection, onChanged, startSignIn = false }: {
    connection: Connection; onChanged: () => void; startSignIn?: boolean;
  } = $props();
  const action = createAction();
  let active = true;
  let connecting = $state(false);
  async function signIn() {
    connecting = true;
    try {
      const result = await api.post<{ authorizationUrl: string }>(`/connections/${connection.id}/oauth/connect`);
      if (active) window.location.assign(result.authorizationUrl);
    } finally { connecting = false; }
  }
  onMount(() => {
    if (startSignIn) {
      // Consume the navigation hint before starting: refresh/retry must not create a duplicate connection.
      window.history.replaceState(null, '', `#/connections/${connection.id}`);
      void action.run(signIn);
    }
    return () => { active = false; };
  });
  function connect() { void action.run(signIn); }
  function disconnect() {
    void action.run(async () => {
      await api.post(`/connections/${connection.id}/oauth/disconnect`);
      if (active) onChanged();
    });
  }
</script>

<details open={authenticationMethod(connection) === 'oauth' || startSignIn}>
  <summary>{authenticationMethod(connection) === 'oauth' ? 'Authentication' : 'Sign in with OAuth'}</summary>
  <div class="stack">
    <p class="muted small">This is a shared connection. Agents granted it use the account you sign in with. Signing in does not enable tools or grant agent access.</p>
    <div class="row wrap">
      <button type="button" disabled={action.busy || Boolean(connection.disabledAt)} onclick={connect}>
        {connecting ? 'Connecting…' : isAuthenticated(connection) && authenticationMethod(connection) === 'oauth' ? 'Sign in again' : 'Sign in'}
      </button>
      <button type="button" class="secondary" disabled={action.busy} onclick={onChanged}>Refresh status</button>
      {#if authenticationMethod(connection) === 'oauth'}
        <button type="button" class="secondary" disabled={action.busy} onclick={disconnect}>Disconnect</button>
      {/if}
    </div>
    <ErrorNote error={action.error} />
  </div>
</details>
