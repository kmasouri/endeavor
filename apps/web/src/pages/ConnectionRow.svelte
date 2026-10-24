<script lang="ts">
  import { api, type Connection } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';
  import EnableButton from './EnableButton.svelte';

  let props: {
    connection: Connection;
    onChanged: () => void;
  } = $props();
  let c = $derived(props.connection);
  let credential = $state('');
  const action = createAction();
  const setSecret = (value: string | null) =>
    void action
      .run(() => api.patch(`/connections/${c.id}`, { credential: value }))
      .then((ok) => ok && ((credential = ''), props.onChanged()));
</script>

<li>
  <div class="row">
    <span class="grow">
      <strong>
        {c.name}
      </strong>

      {#if c.disabledAt}
        <span class="badge"> disabled </span>
      {/if}

      <span class="badge">
        {#if c.hasCredential}
          credential saved
        {:else}
          no credential
        {/if}
      </span>

      <div class="muted small">
        {c.description} · {c.baseUrl}
      </div>

      <div class="muted small">
        Allowed: {c.allowedMethods.join(', ')} on {c.allowedPathPrefixes.join(', ')}

        {#if c.approvalMethods.length > 0}
          {` · needs approval: ${c.approvalMethods.join(', ')}`}
        {/if}
      </div>
    </span>

    <EnableButton
      path={`/connections/${c.id}`}
      disabled={Boolean(c.disabledAt)}
      onChanged={props.onChanged}
    />
  </div>

  <details>
    <summary> Replace or remove the credential </summary>

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

      <button disabled={action.busy || !credential}> Replace </button>

      {#if c.hasCredential}
        <button
          type="button"
          class="secondary"
          disabled={action.busy}
          onclick={() => setSecret(null)}
        >
          Remove
        </button>
      {/if}
    </form>

    <ErrorNote error={action.error} />
  </details>
</li>
