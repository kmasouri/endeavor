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
  let request = $derived(approval.request);
</script>

<div class="stack">
  <div>
    <strong>
      {#if request.kind === 'mcp'}{request.tool}{:else}{request.method} {request.path}{/if}
    </strong>

    on {request.connectionName}
  </div>

  {#if request.kind === 'mcp'}
    <div class="muted small">{request.baseUrl}</div>
    <pre>{JSON.stringify(request.arguments, null, 2)}</pre>
  {:else if request.body}
    <pre>{request.body}</pre>
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
