<script lang="ts">
  import { api, type Connection, type Grant, type Skill } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction, createLoad } from '../state.svelte';

  let {
    agentId
  }: {
    agentId: string;
  } = $props();
  const grants = createLoad(
    () => api.get<Grant[]>(`/agents/${agentId}/grants`),
    () => [agentId]
  );
  const skills = createLoad(
    () => api.list<Skill>('/skills?limit=100'),
    () => []
  );
  const connections = createLoad(
    () => api.list<Connection>('/connections?limit=100'),
    () => []
  );
  let choice = $state('');
  const action = createAction();
  const nameOf = (grant: Grant) =>
    (grant.targetType === 'skill'
      ? skills.data?.data.find((s) => s.id === grant.targetId)?.name
      : connections.data?.data.find((c) => c.id === grant.targetId)?.name) ?? grant.targetId;
  let granted = $derived(new Set((grants.data ?? []).map((g) => g.targetId)));
  const grant = (event: SubmitEvent) => {
    event.preventDefault();
    const [type, id] = choice.split(':');
    void action
      .run(() => api.post(`/agents/${agentId}/grants`, { type, id }))
      .then((ok) => ok && ((choice = ''), grants.reload()));
  };
</script>

<h2>Access</h2>

<Hint>
  Being in a catalog gives no agent access. Access comes from these grants. Revoking takes effect on
  the agent's next tool call.
</Hint>

<ErrorNote error={grants.error} />

<ul class="list">
  {#if (grants.data ?? []).length === 0}
    <li class="muted">No access granted.</li>
  {/if}

  {#each grants.data ?? [] as g (`${g.targetType}:${g.targetId}`)}
    <li class="row">
      <span class="grow">
        {nameOf(g)}

        <span class="muted small">
          ({g.targetType})
        </span>
      </span>

      <button
        class="secondary"
        disabled={action.busy}
        onclick={() =>
          void action
            .run(() => api.delete(`/agents/${agentId}/grants/${g.targetType}/${g.targetId}`))
            .then(grants.reload)}
      >
        Revoke
      </button>
    </li>
  {/each}
</ul>

<form onsubmit={grant} class="row">
  <select class="grow" bind:value={choice}>
    <option value=""> Grant access to… </option>

    {#each (skills.data?.data ?? []).filter((s) => !granted.has(s.id) && !s.disabledAt) ?? [] as s (s.id)}
      <option value={`skill:${s.id}`}>
        Skill: {s.name}
      </option>
    {/each}

    {#each (connections.data?.data ?? []).filter((c) => !granted.has(c.id) && !c.disabledAt) ?? [] as c (c.id)}
      <option value={`connection:${c.id}`}>
        Connection: {c.name}
      </option>
    {/each}
  </select>

  <button disabled={action.busy || !choice}> Grant </button>
</form>

<ErrorNote error={action.error} />
