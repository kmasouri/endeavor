<script lang="ts">
  import { api, type Approval } from '../api';
  import { createNames } from '../names.svelte';
  import { createLoad } from '../state.svelte';
  import ApprovalCard from './ApprovalCard.svelte';

  let {
    taskId,
    onDone
  }: {
    taskId: string;
    onDone: () => void;
  } = $props();
  const approvals = createLoad(
    () => api.list<Approval>('/approvals?status=pending&limit=100'),
    () => [],
    4000
  );
  const name = createNames();
  let taskApprovals = $derived((approvals.data?.data ?? []).filter((approval) => approval.taskId === taskId));
</script>

{#if taskApprovals.length > 0}
  <h3>Needs your approval</h3>

  {#each taskApprovals ?? [] as approval (approval.id)}
    <ApprovalCard
      {approval}
      agentName={name({ type: 'agent', id: approval.agentId })}
      onDone={() => (approvals.reload(), onDone())}
    />
  {/each}
{/if}
