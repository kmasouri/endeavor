<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import type { Approval } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { formatDateTime } from '../components';
  import { createLoad } from '../state.svelte';
  import { createNames } from '../names.svelte';
  import ApprovalCard from './ApprovalCard.svelte';
  import { loadAll } from './agent-data';
  import './creation.css';
  import './list-filters.css';

  let filter = $state('Pending');
  const pending = createLoad(
    () => loadAll<Approval>('/approvals?status=pending'),
    () => [],
    4000
  );
  const decided = createLoad(
    async () => {
      if (filter !== 'History') return [];
      const [approved, rejected] = await Promise.all([
        loadAll<Approval>('/approvals?status=approved'),
        loadAll<Approval>('/approvals?status=rejected')
      ]);
      return [...approved, ...rejected].sort((a, b) =>
        (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt)
      );
    },
    () => [filter]
  );
  const name = createNames();
</script>

<div class="approvals-page creation-page">
  <PageHeader title="Approvals" subtitle="Review requests and past decisions." />
  <div class="list-filters approval-filters" aria-label="Filter approvals">
    {#each ['Pending', 'History'] as value (value)}
      <button aria-pressed={filter === value} onclick={() => (filter = value)}>{value}</button>
    {/each}
  </div>

  {#if filter === 'Pending'}
    <p class="hint">
      Agents work on their own within their access. Some actions, set per connection, wait for a
      person first. Agents can also ask for access to a skill or connection people made
      discoverable. The agent's task waits until you decide, and it's told your reason.
    </p>

    <ErrorNote error={pending.error} />

    {#if !pending.data && !pending.error}
      <p class="muted">Loading requests…</p>
    {:else if pending.data?.length === 0}
      <p class="muted">Nothing waiting for you.</p>
    {/if}

    {#each pending.data ?? [] as approval (approval.id)}
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
  {:else}
    <ErrorNote error={decided.error} />
    {#if !decided.data && !decided.error}
      <p class="muted">Loading past decisions…</p>
    {:else if decided.data?.length === 0}
      <p class="muted">No past decisions yet.</p>
    {/if}
    <ul class="list">
      {#each decided.data ?? [] as approval (approval.id)}
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
              {` · ${approval.request.kind === 'access' ? 'not added' : 'not made'}: ${approval.result.error}`}
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

<style>
  .approval-filters {
    margin: 24px 0;
  }
</style>
