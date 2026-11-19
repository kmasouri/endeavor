<script lang="ts">
  import RunInspector from './RunInspector.svelte';
  import { go } from '../state.svelte';
  let { taskId }: { taskId: string } = $props();
</script>

<div class="standalone-run">
  <RunInspector {taskId} readOnly onLoaded={(task) => {
    if (task.conversationId) go(`/conversations/${task.conversationId}?run=${task.id}`);
  }} />
</div>
