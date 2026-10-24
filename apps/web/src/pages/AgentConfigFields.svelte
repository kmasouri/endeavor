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
  import CheckGroup from '../CheckGroup.svelte';
  import Hint from '../Hint.svelte';
  import { toLimit } from '../components';
  import { createLoad } from '../state.svelte';
  import { type ConfigValues } from './AgentConfig';

  let props: {
    current?: AgentVersion | null;
    onChange: (values: ConfigValues) => void;
  } = $props();
  const providers = createLoad(
    () => api.get<ProviderStatus[]>('/providers'),
    () => []
  );
  const skills = createLoad(
    () => api.list<Skill>('/skills?limit=100'),
    () => []
  );
  const connections = createLoad(
    () => api.list<Connection>('/connections?limit=100'),
    () => []
  );
  let current = $derived(props.current);
  // Start from this version once; polling must not overwrite what someone is typing.
  let instructions = $state(untrack(() => current?.instructions ?? ''));
  let provider = $state<Provider>(untrack(() => current?.provider ?? 'openai'));
  let model = $state(untrack(() => current?.model ?? ''));
  // Omitted lists preserve existing pins and grants until the user changes them.
  let skillIds = $state<string[] | undefined>();
  let connectionIds = $state<string[] | undefined>();
  let turns = $state(untrack(() => String(current?.limits.maxModelTurns ?? '')));
  let tokens = $state(untrack(() => String(current?.limits.maxTokens ?? '')));
  let minutes = $state(untrack(() => String(current?.limits.maxWorkingMinutes ?? '')));
  let cost = $state(untrack(() => String(current?.limits.maxCostUsd ?? '')));
  let enabledSkills = $derived((skills.data?.data ?? []).filter((skill) => !skill.disabledAt));
  let enabledConnections = $derived((connections.data?.data ?? []).filter((c) => !c.disabledAt));
  let chosenSkills = $derived(
    skillIds ??
      enabledSkills
        .filter((skill) => current?.skillVersionIds.includes(skill.currentVersionId ?? ''))
        .map((skill) => skill.id)
  );
  let chosenConnections = $derived(connectionIds ?? current?.connectionIds ?? []);
  let olderSkillVersions = $derived(
    (current?.skillVersionIds.length ?? 0) -
      enabledSkills.filter((s) => current?.skillVersionIds.includes(s.currentVersionId ?? ''))
        .length
  );
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
  let ready = $derived(providers.data?.find((p) => p.provider === provider));
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
      {#each providers.data ?? [] as p (p.provider)}
        <option value={p.provider}>
          {p.provider}

          {#if !p.ready}
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

<fieldset>
  <legend> Skills </legend>

  <Hint>Skills add reusable instructions. They never select connections or grant API access.</Hint>

  <CheckGroup
    options={enabledSkills.map((skill) => ({
      value: skill.id,
      label: skill.name,
      description: skill.description
    }))}
    selected={chosenSkills}
    onChange={(selected) => ((skillIds = selected), report())}
  />

  {#if olderSkillVersions > 0 && !skillIds}
    <Hint>
      {olderSkillVersions} chosen skill(s) are pinned to an older version. They stay as they are unless
      you change this list.
    </Hint>
  {/if}
</fieldset>

<fieldset>
  <legend> Connections </legend>

  <Hint>Outside APIs the agent may call. Each call is still checked, and some need approval.</Hint>

  {#if current?.legacyConnectionIds?.length}
    <p class="error" role="status">
      An older skill version listed connections that are not selected here:
      {current.legacyConnectionIds.map((id) => connections.data?.data.find((c) => c.id === id)?.name ?? id).join(', ')}.
      Select any you still need below. Save the configuration, then move open tasks to the new
      version from their task page. Existing grants stay as they are; restore revoked grants
      separately on the agent page.
    </p>
  {/if}

  <CheckGroup
    options={enabledConnections.map((connection) => ({
      value: connection.id,
      label: connection.name,
      description: connection.description
    }))}
    selected={chosenConnections}
    onChange={(selected) => ((connectionIds = selected), report())}
  />
</fieldset>

<fieldset>
  <legend> Limits per task </legend>

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
</fieldset>
