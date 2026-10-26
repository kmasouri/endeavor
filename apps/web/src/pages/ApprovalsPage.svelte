<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import { api, type Approval } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { formatDateTime } from '../components';
  import { createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';
  import ApprovalCard from './ApprovalCard.svelte';

  let showDecided = $state(false);
  const pending = createLoad(
    () => api.list<Approval>('/approvals?status=pending&limit=100'),
    () => [],
    4000
  );
  const decided = createLoad(
    () =>
      showDecided
        ? api.list<Approval>('/approvals?limit=100')
        : Promise.resolve({ data: [] as Approval[], page: { limit: 0, offset: 0, total: 0 } }),
    () => [showDecided]
  );
  const name = createNames();
</script>

<PageHeader title="Approvals" subtitle="Requests waiting for a person’s decision." />

<div class="narrow wide">
  <Hint>
    Agents work on their own within their access. Some actions, set per connection, wait for a
    person first. Agents can also ask for access to a skill or connection people made
    discoverable. The agent's task waits until you decide, and it's told your reason.
  </Hint>

  <ErrorNote error={pending.error} />

  {#if pending.data?.data.length === 0}
    <p class="muted">Nothing waiting for you.</p>
  {/if}

  {#each pending.data?.data ?? [] as approval (approval.id)}
    <div class="panel">
      <p class="muted small">
        <span class="badge">
          {approval.request.kind === 'access' ? 'Access request' : 'Action'}
        </span>
        {name({ type: 'agent', id: approval.agentId })} asked {formatDateTime(approval.createdAt)} for

        <a href={`#/tasks/${approval.taskId}`}> this task </a>
      </p>

      <ApprovalCard
        {approval}
        agentName={name({ type: 'agent', id: approval.agentId })}
        onDone={() => (pending.reload(), decided.reload())}
      />
    </div>
  {/each}

  <label class="check">
    <input type="checkbox" bind:checked={showDecided} />

    Show past decisions
  </label>

  {#if showDecided}
    <ul class="list">
      {#each (decided.data?.data ?? []).filter((approval) => approval.status !== 'pending') ?? [] as approval (approval.id)}
        <li>
          {#if approval.request.kind === 'access'}
            <strong>{approval.request.targetType} access to {approval.request.name}</strong>
            <span class="badge">
              {approval.status === 'approved'
                ? approval.duration === 'ongoing'
                  ? 'allowed ongoing'
                  : 'allowed for the task'
                : approval.status === 'rejected'
                  ? "didn't allow"
                  : approval.status}
            </span>
          {:else}
            <strong>
              {#if approval.request.kind === 'mcp'}{approval.request.tool}{:else}{approval.request.method} {approval.request.path}{/if}
            </strong>

            on {approval.request.connectionName}

            <span class="badge">
              {approval.status}
            </span>
          {/if}

          <div class="muted small">
            {name({ type: 'agent', id: approval.agentId })}

            {#if approval.decidedAt}
              {` · decided ${formatDateTime(approval.decidedAt)}`}
            {/if}

            {#if approval.reason}
              {` · ${approval.reason}`}
            {/if}

            {#if approval.result?.error}
              {` · not made: ${approval.result.error}`}
            {/if}

            {#if approval.result?.status}
              {` · HTTP ${approval.result.status}`}
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
