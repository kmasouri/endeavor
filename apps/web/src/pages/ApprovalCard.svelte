<script lang="ts">
  import { api, type AccessDuration, type AccessRequest, type Approval } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  let {
    approval,
    agentName = 'The agent',
    onDone
  }: {
    approval: Approval;
    agentName?: string;
    onDone: () => void;
  } = $props();
  let reason = $state('');
  // Access lasts for this task unless the person picks ongoing. The agent only recommends.
  let duration = $state<AccessDuration>('task');
  let showScope = $state(false);
  const action = createAction();
  const decide = (verb: 'approve' | 'reject') =>
    void action
      .run(() =>
        api.post(`/approvals/${approval.id}/${verb}`, {
          ...(reason && { reason }),
          ...(verb === 'approve' && access && { duration })
        })
      )
      .then((ok) => ok && onDone());
  let request = $derived(approval.request);
  let access = $derived(request.kind === 'access' ? (request as AccessRequest) : null);
</script>

{#if access}
  <div class="access-request stack">
    <div class="stack tight">
      <div class="access-title">Give {agentName} access to {access.name}?</div>
      <div class="access-reason">“{access.reason}”</div>
    </div>

    <div class="access-tile">
      <strong>
        {access.name}{access.targetType === 'skill' && access.skillVersion
          ? ` (version ${access.skillVersion})`
          : ''}
      </strong>
      <span class="small">{access.description}</span>
      {#if access.scope}
        <button
          type="button"
          class="link-button small"
          aria-expanded={showScope}
          onclick={() => (showScope = !showScope)}
        >
          {showScope ? 'Hide the allowed requests' : 'See the allowed requests'}
        </button>
        {#if showScope}
          <div class="small muted">
            {#if access.scope.kind === 'mcp'}
              Tools: {access.scope.tools.join(', ') || 'none'}
            {:else}
              {access.scope.methods.join(', ')} on {access.scope.pathPrefixes.join(', ')}
            {/if}
          </div>
        {/if}
      {:else}
        <span class="small muted">Instructions only. It grants no connection.</span>
      {/if}
    </div>

    <div class="stack tight">
      <span class="access-question" id={`duration-${approval.id}`}>How long should access last?</span>
      <div class="access-choices" role="radiogroup" aria-labelledby={`duration-${approval.id}`}>
        <label class="access-choice" class:on={duration === 'task'}>
          <input type="radio" bind:group={duration} value="task" />
          <span class="stack tight">
            <b>For this task</b>
            <span class="small">Until this task is done or cancelled. Pausing keeps access.</span>
          </span>
        </label>
        <label class="access-choice" class:on={duration === 'ongoing'}>
          <input type="radio" bind:group={duration} value="ongoing" />
          <span class="stack tight">
            <b>Ongoing</b>
            <span class="small">For this task and future work, until you take it away.</span>
          </span>
        </label>
      </div>
      {#if access.recommendedDuration}
        <span class="small muted">
          {agentName} suggests {access.recommendedDuration === 'task' ? 'this task only' : 'ongoing'}{access.durationReason
            ? `: ${access.durationReason}`
            : '.'}
        </span>
      {/if}
      <span class="small muted">
        Only {agentName} gets access. You can take it away at any time.
      </span>
    </div>

    <input bind:value={reason} placeholder="Reason (optional)" aria-label="Reason (optional)" />

    <div class="row">
      <button disabled={action.busy} onclick={() => decide('approve')}>
        {duration === 'task' ? 'Allow for this task' : 'Allow ongoing'}
      </button>

      <button class="secondary" disabled={action.busy} onclick={() => decide('reject')}>
        Don't allow
      </button>
    </div>

    <ErrorNote error={action.error} />
  </div>
{:else if request.kind !== 'access'}
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
{/if}

<style>
  .tight {
    gap: 4px;
  }
  .access-title {
    font-size: 17px;
    font-weight: 600;
  }
  .access-reason,
  .access-choice .small {
    color: var(--text-200);
  }
  .access-tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px;
    border-radius: var(--radius-lg, 10px);
    background: var(--bg-100);
    border: 1px solid var(--border-200);
  }
  .access-question {
    font-size: 14px;
    font-weight: 600;
  }
  .access-choices {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .access-choice {
    flex: 1 1 220px;
    display: flex;
    flex-direction: row;
    gap: 10px;
    align-items: flex-start;
    padding: 12px;
    border-radius: var(--radius-lg, 10px);
    border: 1px solid var(--border-100);
    background: transparent;
    cursor: pointer;
  }
  .access-choice.on {
    background: var(--bg-300);
    border-color: var(--border-200);
  }
  .access-choice input {
    margin-top: 3px;
    flex: none;
  }
  .link-button {
    align-self: flex-start;
    margin-top: 4px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-200);
    min-height: 0;
    height: auto;
  }
</style>
