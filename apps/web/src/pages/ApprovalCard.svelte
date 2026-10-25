<script lang="ts">
  import { api, type Approval } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  let {
    approval,
    onDone
  }: {
    approval: Approval;
    onDone: () => void;
  } = $props();
  let reason = $state('');
  const action = createAction();
  const decide = (verb: 'approve' | 'reject') =>
    void action
      .run(() => api.post(`/approvals/${approval.id}/${verb}`, reason ? { reason } : {}))
      .then((ok) => ok && onDone());
  let r = $derived(approval.request);
</script>

<div class="stack">
  <div>
    <strong>
      {#if r.kind === 'mcp'}{r.tool}{:else}{r.method} {r.path}{/if}
    </strong>

    on {r.connectionName}
  </div>

  {#if r.kind === 'mcp'}
    <div class="muted small">{r.baseUrl}</div>
    <pre>{JSON.stringify(r.arguments, null, 2)}</pre>
  {:else if r.body}
    <pre>{r.body}</pre>
  {/if}

  <input bind:value={reason} placeholder="Reason (optional)" />

  <div class="row">
    <button disabled={action.busy} onclick={() => decide('approve')}> Allow once </button>

    <button class="secondary" disabled={action.busy} onclick={() => decide('reject')}>
      Don't allow
    </button>
  </div>

  <ErrorNote error={action.error} />
</div>
