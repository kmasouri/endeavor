<script lang="ts">
  import { api, type Conversation, type Project } from '../api';
  import { canonicalConversationName } from '../appearance';
  import { createAction } from '../state.svelte';
  import Modal from '../Modal.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  let { project, onCreated, onClose }: { project: Project; onCreated: (conversation: Conversation) => void; onClose: () => void } = $props();
  let request = $state('');
  let created = $state<Conversation | null>(null);
  const clientKey = crypto.randomUUID();
  const action = createAction();
  async function start(event: SubmitEvent) {
    event.preventDefault();
    if (!request.trim()) return;
    await action.run(async () => {
      // Retain the created endeavor if posting fails. Retry the same message with its stable key.
      created ??= await api.post<Conversation>('/conversations', {
        projectId: project.id,
        title: canonicalConversationName(request).slice(0, 64).replace(/-$/, '') || 'new-request'
      });
      await api.post(`/conversations/${created.id}/messages`, { body: request.trim(), clientKey });
      onCreated(created);
    });
  }
</script>

<Modal title="New request" busy={action.busy} {onClose}>
  <form class="stack" onsubmit={start}>
    <p class="muted">Start an endeavor in {project.name}. Its members and knowledge sources come from this project.</p>
    <label>What do you want to accomplish?<textarea bind:value={request} rows={5} maxlength="20000" required disabled={action.busy || Boolean(created)}></textarea></label>
    <p class="caption muted">Your request becomes the goal. Done criteria are filled in automatically.</p>
    <ErrorNote error={action.error} />
    {#if created}<p class="caption">Your endeavor is ready. Retry to send your request, or <a href={`#/conversations/${created.id}`} onclick={onClose}>open it</a>.</p>{/if}
    <footer class="dialog-footer">
      <button type="button" class="secondary" disabled={action.busy} onclick={onClose}>Cancel</button>
      <button disabled={action.busy || !request.trim()}>{action.busy ? 'Starting…' : created ? 'Retry request' : 'Start endeavor'}</button>
    </footer>
  </form>
</Modal>
