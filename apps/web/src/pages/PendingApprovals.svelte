<script lang="ts">
  import { api, type Approval } from '../api';
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
  let taskApprovals = $derived((approvals.data?.data ?? []).filter((approval) => approval.taskId === taskId));
</script>

{#if taskApprovals.length > 0}
  <h3>Needs your approval</h3>

  {#each taskApprovals ?? [] as approval (approval.id)}
    <ApprovalCard {approval} onDone={() => (approvals.reload(), onDone())} />
  {/each}
{/if}
