<script lang="ts">
  import Avatar from '../Avatar.svelte';
  import {
    type Agent,
    type AgentVersion,
    type Skill,
    type Connection,
    type Task,
    api
  } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import StateBadge from '../StateBadge.svelte';
  import { when } from '../components';
  import { createAction, createLoad } from '../state.svelte';
  import SavedNotes from './SavedNotes.svelte';
  import Spending from './Spending.svelte';
  import Profile from './Profile.svelte';
  import NewVersion from './NewVersion.svelte';
  import AgentStatus from './AgentStatus.svelte';
  import { loadAll, versionChanges } from './agent-data';
  import './agents.css';
  let { agentId }: { agentId: string } = $props();
  const agent = createLoad(
    () => api.get<Agent>(`/agents/${agentId}`),
    () => [agentId]
  );
  const versions = createLoad(
    () => api.get<AgentVersion[]>(`/agents/${agentId}/versions`),
    () => [agentId]
  );
  const tasks = createLoad(
    () => loadAll<Task>(`/tasks?ownerAgentId=${agentId}`),
    () => [agentId],
    10000
  );
  const skills = createLoad(
    () => loadAll<Skill>('/skills'),
    () => []
  );
  const connections = createLoad(
    () => loadAll<Connection>('/connections'),
    () => []
  );
  let tab = $state('Overview');
  let editingProfile = $state(false);
  let configRevision = $state(0);
  const action = createAction();
  const reloadAll = () => {
    agent.reload();
    versions.reload();
    tasks.reload();
  };
  const toggle = () =>
    void action
      .run(() => api.post(`/agents/${agentId}/${agent.data?.disabledAt ? 'enable' : 'disable'}`))
      .then((ok) => ok && agent.reload());
  let a = $derived(agent.data);
  let current = $derived(a?.currentVersion);
  let open = $derived(
    (tasks.data ?? []).filter((t) => !['completed', 'cancelled'].includes(t.state))
  );
  let ordered = $derived([...(versions.data ?? [])].sort((a, b) => b.version - a.version));
  const onVersion = (id: string) => open.filter((t) => t.agentVersionId === id);
  const move = (id: string) =>
    void action.run(async () => {
      // Move each task deliberately; successful moves remain visible if a later task fails.
      try {
        for (const task of onVersion(id))
          await api.post(`/tasks/${task.id}/version`, {
            versionId: a!.currentVersionId,
            reason: 'Moved from agent version history'
          });
      } finally {
        tasks.reload();
      }
    });
  const names = (ids: string[], entries: { id: string; name: string }[] | undefined) =>
    ids.map((id) => entries?.find((entry) => entry.id === id)?.name ?? id).join(', ') || 'None';
</script>

<div class="agents-page">
  <a class="agent-back" href="#/agents">← Agents</a>
  <ErrorNote error={agent.error} />
  {#if !a && !agent.error}<p>Loading agent…</p>{:else if a}
    <header class="agent-detail-header">
      <div class="agent-heading">
        <Avatar name={a.name} id={a.id} agent />
        <div>
          <div class="row wrap">
            <h1>{a.name}</h1>
            <span class="agent-label">agent</span><AgentStatus agent={a} />
          </div>
          <p>{a.purpose}</p>
        </div>
      </div>
      <button class="secondary" disabled={action.busy} onclick={toggle}
        >{a.disabledAt ? 'Enable' : 'Disable'}</button
      >
    </header>
    {#if a.disabledAt}<p class="hint">
        This agent takes no new work. Its open tasks keep going until someone pauses or cancels them
        in their endeavor.
      </p>{/if}
    {#if !a.providerReady}<p class="error">
        This agent needs provider setup before its tasks can run. <a href="#/setup">Open Setup</a>.
      </p>{/if}
    <nav class="agent-tabs" aria-label="Agent sections">
      {#each ['Overview', 'Configuration', 'Versions'] as value (value)}<button
          aria-current={tab === value ? 'page' : undefined}
          onclick={() => (tab = value)}
          >{value}{value === 'Versions' ? ` · ${ordered.length}` : ''}</button
        >{/each}
    </nav>
    <ErrorNote error={action.error} />
    {#if tab === 'Overview'}
      <div class="agent-overview">
        <div>
          <section class="panel">
            <div class="agent-card-head">
              <div>
                <h2>Current configuration</h2>
                <span class="caption muted">Version {current?.version ?? '—'}</span>
              </div>
              <button class="text-button" onclick={() => (tab = 'Configuration')}
                >Edit configuration</button
              >
            </div>
            {#if current}<dl class="agent-kv">
                <dt>Provider</dt>
                <dd>{current.provider}</dd>
                <dt>Model</dt>
                <dd>{current.model}</dd>
                <dt>Skills</dt>
                <dd>
                  {names(
                    current.skillIds ??
                      (skills.data ?? [])
                        .filter((s) => current.skillVersionIds.includes(s.currentVersionId ?? ''))
                        .map((s) => s.id),
                    skills.data
                  )}
                </dd>
                <dt>Connections</dt>
                <dd>{names(current.connectionIds, connections.data)}</dd>
                <dt>Limits per task</dt>
                <dd>
                  {current.limits.maxModelTurns
                    ? `${current.limits.maxModelTurns} model turns · `
                    : ''}{current.limits.maxTokens
                    ? `${current.limits.maxTokens} tokens · `
                    : ''}{current.limits.maxCostUsd
                    ? `$${current.limits.maxCostUsd.toFixed(2)}`
                    : 'Default cost cap'}{current.limits.maxWorkingMinutes
                    ? ` · ${current.limits.maxWorkingMinutes} working minutes`
                    : ''}
                </dd>
              </dl>
              <pre class="agent-instructions">{current.instructions}</pre>{:else}<p>
                No configuration yet.
              </p>{/if}
            <ErrorNote error={skills.error ?? connections.error} />
          </section>
          <section class="panel">
            <h2>Open work · {open.length}</h2>
            <p class="caption muted">Each task keeps the version it started with.</p>
            <ErrorNote error={tasks.error} />
            <ul class="list">
              {#each open as task (task.id)}<li>
                  <div class="row wrap">
                    <a class="grow" href={`#/tasks/${task.id}`}>{task.title}</a><StateBadge
                      state={task.state}
                      paused={Boolean(task.pausedAt)}
                    /><span class="caption muted"
                      >Version {ordered.find((v) => v.id === task.agentVersionId)?.version ??
                        '—'}</span
                    >
                  </div>
                </li>{/each}
            </ul>
            {#if !open.length && tasks.data}<p class="muted">
                No open work.
              </p>{/if}{#if open.some((t) => t.agentVersionId !== a.currentVersionId)}<button
                class="text-button"
                onclick={() => (tab = 'Versions')}>Move older tasks to the current version</button
              >{/if}
          </section>
        </div>
        <div>
          {#if editingProfile}<Profile
              agent={a}
              onSaved={() => {
                editingProfile = false;
                agent.reload();
              }}
            />{:else}<section class="panel">
              <div class="agent-card-head">
                <h2>Profile</h2>
                <button class="text-button" onclick={() => (editingProfile = true)}>Edit</button>
              </div>
              <dl class="agent-kv">
                <dt>Name</dt>
                <dd>{a.name}</dd>
                <dt>Purpose</dt>
                <dd>{a.purpose}</dd>
              </dl>
              <p class="caption muted">Not versioned. A change shows everywhere at once.</p>
            </section>{/if}
          <section class="panel">
            <Spending kind="agent" id={a.id} onBudgetSaved={agent.reload} />
          </section>
          <section class="panel"><SavedNotes agentId={a.id} /></section>
        </div>
      </div>
    {:else if tab === 'Configuration'}
      {#key `${a.currentVersionId}:${configRevision}`}<NewVersion
          agent={a}
          onDiscard={() => configRevision++}
          onSaved={reloadAll}
        />{/key}
    {:else}
      <p class="muted">
        A saved version never changes. Each task keeps the version it started with. Moving open work
        is a separate step, recorded with who did it and why.
      </p>
      <ErrorNote error={versions.error ?? tasks.error} />
      <div aria-label="Versions">
        {#each ordered as version, i (version.id)}<article class="agent-version">
            <strong>v{version.version}</strong>
            <div>
              <div class="row wrap">
                <h2>{versionChanges(version, ordered[i + 1]).join(' · ')}</h2>
                {#if version.id === a.currentVersionId}<span class="agent-status enabled"
                    >Current</span
                  >{/if}
              </div>
              <p class="caption muted">
                {when(version.createdAt)} · {version.provider} · {version.model} · {onVersion(
                  version.id
                ).length} open tasks
              </p>
              {#if version.legacyConnectionIds?.length}<p class="error">
                  This version relied on inherited connections. Review explicit connections on the
                  Configuration tab and save.
                </p>{/if}
              <details>
                <summary>Instructions</summary>
                <pre class="agent-instructions">{version.instructions}</pre>
              </details>
            </div>
            {#if version.id !== a.currentVersionId && onVersion(version.id).length}<button
                class="secondary"
                disabled={action.busy}
                onclick={() => move(version.id)}
                >Move {onVersion(version.id).length} task{onVersion(version.id).length === 1
                  ? ''
                  : 's'} to v{current?.version}</button
              >{/if}
          </article>{/each}
      </div>
      <p class="caption muted">
        Finished tasks don’t move. Restart one to run it on the current version.
      </p>
    {/if}
  {/if}
</div>
