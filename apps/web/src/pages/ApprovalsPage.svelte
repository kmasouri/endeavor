<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import { api, type Approval } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { when } from '../components';
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
    person first. The agent's task waits until you decide, and it's told your reason.
  </Hint>

  <ErrorNote error={pending.error} />

  {#if pending.data?.data.length === 0}
    <p class="muted">Nothing waiting for you.</p>
  {/if}

  {#each pending.data?.data ?? [] as approval (approval.id)}
    <div class="panel">
      <p class="muted small">
        {name({ type: 'agent', id: approval.agentId })} asked {when(approval.createdAt)} for

        <a href={`#/tasks/${approval.taskId}`}> this task </a>
      </p>

      <ApprovalCard {approval} onDone={() => (pending.reload(), decided.reload())} />
    </div>
  {/each}

  <label class="check">
    <input type="checkbox" bind:checked={showDecided} />

    Show past decisions
  </label>

  {#if showDecided}
    <ul class="list">
      {#each (decided.data?.data ?? []).filter((a) => a.status !== 'pending') ?? [] as approval (approval.id)}
        <li>
          <strong>
            {#if approval.request.kind === 'mcp'}{approval.request.tool}{:else}{approval.request.method} {approval.request.path}{/if}
          </strong>

          on {approval.request.connectionName}

          <span class="badge">
            {approval.status}
          </span>

          <div class="muted small">
            {name({ type: 'agent', id: approval.agentId })}

            {#if approval.decidedAt}
              {` · decided ${when(approval.decidedAt)}`}
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
