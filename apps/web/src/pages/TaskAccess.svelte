<script lang="ts">
  import { api, type TaskCapability } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { formatDateTime } from '../components';
  import { createAction, createLoad } from '../state.svelte';

  // Access a person added to this task after the agent asked for it. Revoking applies from the
  // agent's next call. Ongoing access also lives in the agent's configuration.
  let { taskId, open }: { taskId: string; open: boolean } = $props();
  const access = createLoad(
    () => api.get<(TaskCapability & { name: string })[]>(`/tasks/${taskId}/capabilities`),
    () => [taskId],
    4000
  );
  const action = createAction();
  const revoke = (capabilityId: string) =>
    void action
      .run(() => api.delete(`/tasks/${taskId}/capabilities/${capabilityId}`))
      .then(access.reload);
</script>

{#if (access.data ?? []).length > 0}
  <div class="panel">
    <h2>Access added for this task</h2>

    <ul class="list small">
      {#each access.data ?? [] as entry (entry.id)}
        <li>
          <strong>{entry.name}</strong>
          <span class="badge">{entry.targetType}</span>
          <span class="badge">{entry.duration === 'task' ? 'this task' : 'ongoing'}</span>

          <div class="muted">
            {#if entry.scope}
              {entry.scope.kind === 'mcp'
                ? `Tools: ${entry.scope.tools.join(', ')}`
                : `${entry.scope.methods.join(', ')} on ${entry.scope.pathPrefixes.join(', ')}`}
              ·
            {/if}
            {entry.revokedAt
              ? `Revoked ${formatDateTime(entry.revokedAt)}`
              : !open
                ? 'Ended with the task'
                : `Since ${formatDateTime(entry.grantedAt)}`}
          </div>

          {#if open && !entry.revokedAt}
            <button class="secondary small" disabled={action.busy} onclick={() => revoke(entry.id)}>
              Revoke
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if (access.data ?? []).some((entry) => entry.duration === 'ongoing')}
      <p class="muted small">
        Ongoing access is also in the agent's configuration. Remove it there to take it away from
        future work.
      </p>
    {/if}
    <ErrorNote error={access.error ?? action.error} />
  </div>
{/if}
