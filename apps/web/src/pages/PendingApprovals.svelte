<script lang="ts">
  import { type Approval } from '../api';
  import { createNames } from '../names.svelte';
  import { createLoad } from '../state.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import { loadAll } from './agent-data';
  import ApprovalCard from './ApprovalCard.svelte';

  let {
    taskId,
    onDone
  }: {
    taskId: string;
    onDone: () => void;
  } = $props();
  const approvals = createLoad(
    () => loadAll<Approval>('/approvals?status=pending'),
    () => [],
    4000
  );
  const name = createNames();
  let taskApprovals = $derived((approvals.data ?? []).filter((approval) => approval.taskId === taskId));
</script>

<ErrorNote error={approvals.error} />
{#if approvals.error}<button class="secondary" onclick={approvals.reload}>Retry approvals</button>{/if}

{#if taskApprovals.length > 0}
  <h3>Needs your approval</h3>

  {#each taskApprovals as approval (approval.id)}
    <ApprovalCard
      {approval}
      agentName={name({ type: 'agent', id: approval.agentId })}
      onDone={() => (approvals.reload(), onDone())}
    />
  {/each}
{/if}
