<script lang="ts">
  import { type TaskDetails, type TaskEvent } from '../api';
  import Hint from '../Hint.svelte';

  let {
    task,
    events
  }: {
    task: TaskDetails;
    events: TaskEvent[];
  } = $props();
  let checks = $derived(events.filter((event) => event.type === 'completion.checked'));
  let last = $derived(checks[checks.length - 1]);
</script>

{#if last && last.data.met !== true && task.state !== 'completed'}
  <div class="panel">
    <h2>Open concerns</h2>

    <Hint>
      The completion check found gaps in the agent's last result. The agent is told; you can add
      guidance in the conversation.
    </Hint>

    <p class="body error">
      {String(last.data.summary ?? '')}
    </p>
  </div>
{/if}
