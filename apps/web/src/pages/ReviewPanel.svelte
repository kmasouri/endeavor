<script lang="ts">
  import { api, type Task } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction } from '../state.svelte';

  let {
    task,
    onDone
  }: {
    task: Task;
    onDone: () => void;
  } = $props();
  let notes = $state('');
  const action = createAction();
  let waiting = $derived(
    task.reviewRequired && task.state === 'waiting' && task.criteriaCheck && !task.review
  );
  const review = (approved: boolean) =>
    void action
      .run(() => api.post(`/tasks/${task.id}/review`, { approved, ...(notes && { notes }) }))
      .then((ok) => ok && onDone());
</script>

{#if waiting}
  <div class="panel">
    <h2>Ready for your review</h2>

    <Hint>The result is posted to the conversation once you approve it.</Hint>

    <textarea bind:value={notes} placeholder="Notes (optional)" rows={2}></textarea>

    <div class="row">
      <button disabled={action.busy} onclick={() => review(true)}> Accept </button>

      <button class="secondary" disabled={action.busy} onclick={() => review(false)}>
        Send back
      </button>
    </div>

    <ErrorNote error={action.error} />
  </div>
{/if}
