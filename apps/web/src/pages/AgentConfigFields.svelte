<script lang="ts">
  import { untrack } from 'svelte';
  import {
    type AgentVersion,
    api,
    type Connection,
    type Provider,
    type ProviderStatus,
    type Skill
  } from '../api';
  import AgentPicker from './AgentPicker.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import { loadAll } from './agent-data';
  import Hint from '../Hint.svelte';
  import { toLimit } from '../components';
  import { createLoad } from '../state.svelte';
  import { type ConfigValues } from './AgentConfig';

  let props: {
    current?: AgentVersion | null;
    onChange: (values: ConfigValues) => void;
    initial?: ConfigValues;
  } = $props();
  const providers = createLoad(
    () => api.get<ProviderStatus[]>('/providers'),
    () => []
  );
  const skills = createLoad(
    () => loadAll<Skill>('/skills'),
    () => []
  );
  const connections = createLoad(
    () => loadAll<Connection>('/connections'),
    () => []
  );
  let current = $derived(props.current);
  // Start from this version once; polling must not overwrite what someone is typing.
  let instructions = $state(
    untrack(() => props.initial?.instructions ?? current?.instructions ?? '')
  );
  let provider = $state<Provider>(
    untrack(() => props.initial?.provider ?? current?.provider ?? 'openai')
  );
  let model = $state(untrack(() => props.initial?.model ?? current?.model ?? ''));
  // Omitted lists preserve existing pins and grants until the user changes them.
  let skillIds = $state<string[] | undefined>();
  let connectionIds = $state<string[] | undefined>();
  let turns = $state(untrack(() => String(current?.limits.maxModelTurns ?? '')));
  let tokens = $state(untrack(() => String(current?.limits.maxTokens ?? '')));
  let minutes = $state(untrack(() => String(current?.limits.maxWorkingMinutes ?? '')));
  let cost = $state(untrack(() => String(current?.limits.maxCostUsd ?? '')));

  let originalSkills = $derived(
    current?.skillIds ??
      (skills.data ?? [])
        .filter((skill) => current?.skillVersionIds.includes(skill.currentVersionId ?? ''))
        .map((skill) => skill.id)
  );
  let chosenSkills = $derived(skillIds ?? originalSkills);
  let chosenConnections = $derived(connectionIds ?? current?.connectionIds ?? []);
  const report = () => {
    props.onChange({
      instructions,
      provider,
      model,
      ...(skillIds && { skillIds }),
      ...(connectionIds && { connectionIds }),
      limits: {
        maxModelTurns: toLimit(turns),
        maxTokens: toLimit(tokens),
        maxWorkingMinutes: toLimit(minutes),
        maxCostUsd: Number(cost) > 0 ? Number(cost) : undefined
      }
    });
  };
  let ready = $derived(providers.data?.find((providerInfo) => providerInfo.provider === provider));
</script>

<label>
  Instructions

  <Hint>
    How the agent should behave: its job, its limits, and its style. For example, "Investigate
    billing issues and cite your sources." Instructions aren't saved notes and aren't knowledge
    sources.
  </Hint>

  <textarea
    class="tall"
    value={instructions}
    oninput={(event) => ((instructions = event.currentTarget.value), report())}
    required></textarea>
</label>

<div class="grid2">
  <label>
    Provider

    <select
      value={provider}
      onchange={(event) => {
        const value = event.currentTarget.value as Provider;
        provider = value;
        report();
      }}
    >
      {#each providers.data ?? [] as providerInfo (providerInfo.provider)}
        <option value={providerInfo.provider}>
          {providerInfo.provider}

          {#if !providerInfo.ready}
            (not set up)
          {/if}
        </option>
      {/each}
    </select>
  </label>

  <label>
    Model

    <input
      value={model}
      oninput={(event) => ((model = event.currentTarget.value), report())}
      placeholder={provider === 'openai' ? 'for example, a small, cheap model' : 'model name'}
      required
    />
  </label>
</div>

{#if ready}
  <Hint>
    {#if ready.ready}
      {ready.setup}
    {:else}
      {`Not ready yet. ${ready.setup}`}
    {/if}
  </Hint>
{/if}

<ErrorNote error={providers.error ?? skills.error ?? connections.error} />
<fieldset>
  <legend>Skills</legend>
  <Hint>Reusable instructions. Connections are chosen separately.</Hint>
  <AgentPicker
    kind="skill"
    options={skills.data ?? []}
    selected={chosenSkills}
    original={originalSkills}
    onChange={(ids) => {
      skillIds = ids;
      report();
    }}
  />
</fieldset>
<fieldset>
  <legend>Connections</legend>
  <Hint>Outside APIs the agent may call. Some actions still need approval.</Hint>
  {#if current?.legacyConnectionIds?.length}
    <p class="error" role="status">
      This version relied on inherited connections: {current.legacyConnectionIds
        .map((id) => connections.data?.find((connection) => connection.id === id)?.name ?? id)
        .join(', ')}. Select any you still need, save, and move open tasks to the reviewed version.
    </p>
  {/if}
  <AgentPicker
    kind="connection"
    options={connections.data ?? []}
    selected={chosenConnections}
    original={current?.connectionIds ?? []}
    onChange={(ids) => {
      connectionIds = ids;
      report();
    }}
  />
</fieldset>

<details>
  <summary
    >Limits per task <span class="caption muted">· leave blank to use the defaults</span></summary
  >

  <Hint>A task stops and asks a person when it reaches one. Leave empty for the default.</Hint>

  <div class="grid2">
    <label>
      Model turns

      <input
        inputmode="numeric"
        value={turns}
        oninput={(event) => ((turns = event.currentTarget.value), report())}
      />
    </label>

    <label>
      Tokens

      <input
        inputmode="numeric"
        value={tokens}
        oninput={(event) => ((tokens = event.currentTarget.value), report())}
      />
    </label>

    <label>
      Cost, $

      <input
        inputmode="decimal"
        value={cost}
        placeholder="1.00"
        oninput={(event) => ((cost = event.currentTarget.value), report())}
      />
    </label>

    <label>
      Working minutes

      <input
        inputmode="numeric"
        value={minutes}
        oninput={(event) => ((minutes = event.currentTarget.value), report())}
      />
    </label>
  </div>
</details>
