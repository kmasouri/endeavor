<script lang="ts">
  import { api, type Member, type Task } from '../api';
  import { createAction } from '../state.svelte';
  import Avatar from '../Avatar.svelte';
  import StateBadge from '../StateBadge.svelte';
  import TaskStatus from './TaskStatus.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  let {
    members,
    tasks,
    onChanged,
    onHistory
  }: {
    members: Member[];
    tasks: Task[];
    onChanged: () => void;
    onHistory: (agentId: string) => void;
  } = $props();
  let selected = $state('');
  let showFree = $state(false);
  const action = createAction();
  const activeTasks = (id: string) =>
    tasks.filter(
      (task) => task.ownerAgentId === id && !['completed', 'cancelled'].includes(task.state)
    );
  let agents = $derived(members.filter((member) => member.participant.type === 'agent'));
  let busy = $derived(
    agents
      .filter((member) => activeTasks(member.participant.id).length)
      .sort(
        (a, b) =>
          Number(
            activeTasks(b.participant.id).some((task) => task.state === 'working' && !task.pausedAt)
          ) -
          Number(
            activeTasks(a.participant.id).some((task) => task.state === 'working' && !task.pausedAt)
          )
      )
  );
  let free = $derived(agents.filter((member) => !activeTasks(member.participant.id).length));
  let working = $derived(
    busy.filter((member) =>
      activeTasks(member.participant.id).some((task) => task.state === 'working' && !task.pausedAt)
    ).length
  );
  let waiting = $derived(
    busy.filter((member) =>
      activeTasks(member.participant.id).some((task) => task.state === 'waiting' && !task.pausedAt)
    ).length
  );
  const act = (taskId: string, verb: string) =>
    void action.run(() => api.post(`/tasks/${taskId}/${verb}`)).then((ok) => ok && onChanged());
</script>

<section class="details-agents">
  <div class="row">
    <h2 class="label grow">Agents</h2>
    <span class="caption muted">{working} working · {waiting} waiting · {free.length} free</span>
  </div>
  {#each [...busy, ...(showFree ? free : [])] as member (member.participant.id)}
    {@const current = activeTasks(member.participant.id)}
    <div class="agent-entry" class:selected={selected === member.participant.id}>
      <button
        class="quiet agent-line"
        aria-expanded={selected === member.participant.id}
        onclick={() => (selected = selected === member.participant.id ? '' : member.participant.id)}
        ><Avatar name={member.name} id={member.participant.id} agent /><span class="grow"
          >{member.name} <span class="agent-label">agent</span></span
        ><span class="caption muted"
          >{current[0]?.pausedAt ? 'Paused' : (current[0]?.state ?? 'Free')}</span
        ><span aria-hidden="true">›</span></button
      >
      {#if selected === member.participant.id}
        <div class="agent-expanded">
          {#each current as task (task.id)}
            <p class="small">{task.title}</p>
            <StateBadge state={task.state} paused={Boolean(task.pausedAt)} />
            {#if task.stateReason}<p class="small muted">{task.stateReason}</p>{/if}
            {#if task.state === 'waiting' && !task.pausedAt}<TaskStatus {task} {onChanged} />{/if}
            <div class="row wrap">
              <button
                class="secondary"
                disabled={action.busy}
                onclick={() =>
                  act(task.id, task.pausedAt || task.state === 'blocked' ? 'resume' : 'pause')}
                >{task.pausedAt || task.state === 'blocked' ? 'Resume' : 'Pause'}</button
              ><button
                class="secondary"
                disabled={action.busy}
                onclick={() => act(task.id, 'cancel')}>Stop</button
              >
            </div>
          {/each}
          {#if !current.length}
            {@const last = tasks.find((task) => task.ownerAgentId === member.participant.id)}
            <p class="caption muted">{last ? `Last run: ${last.title}` : 'No active work in this conversation.'}</p>
          {/if}
          <button class="secondary" onclick={() => onHistory(member.participant.id)}>History</button>
        </div>
      {/if}
    </div>
  {/each}
  {#if free.length}<button
      class="quiet free-agents"
      aria-expanded={showFree}
      onclick={() => (showFree = !showFree)}
      >{free.length} more agents <span class="caption muted">· Free</span></button
    >{/if}
  <ErrorNote error={action.error} />
</section>
