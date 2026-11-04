<script lang="ts">
  import { api, type Conversation } from '../api';
  import { createAction } from '../state.svelte';
  import Modal from '../Modal.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  let { conversation, onChanged }: { conversation: Conversation; onChanged: () => void } = $props();
  let editing = $state(false);
  let confirming = $state(false);
  let goal = $state('');
  let criteria = $state('');
  const action = createAction();
  const edit = () => { goal = conversation.goal ?? ''; criteria = conversation.doneCriteria ?? ''; editing = true; };
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (await action.run(() => api.patch(`/conversations/${conversation.id}`, { goal: goal.trim(), doneCriteria: criteria.trim() }))) {
      editing = false; onChanged();
    }
  }
  async function changeState() {
    if (await action.run(() => api.post(`/conversations/${conversation.id}/${conversation.state === 'closed' ? 'reopen' : 'close'}`))) {
      confirming = false; onChanged();
    }
  }
</script>

<section class="endeavor-goal" aria-label="Endeavor goal">
  <div class="row wrap">
    <strong class="grow">{conversation.state === 'closed' ? 'Closed · Goal confirmed done' : 'Open endeavor'}</strong>
    <button class="text-button" onclick={edit}>Edit goal</button>
    {#if conversation.state === 'closed'}
      <button class="secondary" disabled={action.busy} onclick={changeState}>Reopen endeavor</button>
    {:else}<button class="secondary" onclick={() => (confirming = true)}>Confirm goal done</button>{/if}
  </div>
  <details><summary>{conversation.goal || 'Your first request becomes the goal'}</summary>
    <p class="goal-text">{conversation.goal || 'Send a request below to get started.'}</p>
    <h2 class="label">Done when</h2><p class="goal-text">{conversation.doneCriteria || 'Filled in automatically from your first request.'}</p>
  </details>
  <ErrorNote error={action.error} />
</section>
{#if editing}
  <Modal title="Edit endeavor goal" busy={action.busy} onClose={() => (editing = false)}>
    <form class="stack" onsubmit={save}>
      <label>Goal<textarea bind:value={goal} rows={4} maxlength="20000" required disabled={action.busy}></textarea></label>
      <label>Done when<textarea bind:value={criteria} rows={3} maxlength="5000" required disabled={action.busy}></textarea></label>
      <ErrorNote error={action.error} />
      <footer class="dialog-footer"><button type="button" class="secondary" disabled={action.busy} onclick={() => (editing = false)}>Cancel</button><button disabled={action.busy || !goal.trim() || !criteria.trim()}>Save goal</button></footer>
    </form>
  </Modal>
{/if}
{#if confirming}
  <Modal title="Confirm the goal is done" busy={action.busy} onClose={() => (confirming = false)}>
    <p class="goal-text">{conversation.doneCriteria || conversation.goal || 'Does the latest result meet your request?'}</p>
    <p>This archives the endeavor. Running work continues. You can reopen it for follow-ups.</p>
    <ErrorNote error={action.error} />
    <footer class="dialog-footer"><button class="secondary" disabled={action.busy} onclick={() => (confirming = false)}>Keep open</button><button disabled={action.busy} onclick={changeState}>Confirm and close</button></footer>
  </Modal>
{/if}
