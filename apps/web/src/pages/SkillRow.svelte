<script lang="ts">
  import { api, type Skill, type SkillDetails } from '../api';
  import { createLoad } from '../state.svelte';
  import DiscoverableToggle from './DiscoverableToggle.svelte';
  import EnableButton from './EnableButton.svelte';
  import SkillVersionForm from './SkillVersionForm.svelte';

  let props: {
    skill: Skill;
    onChanged: () => void;
  } = $props();
  let open = $state(false);
  const details = createLoad(
    () => (open ? api.get<SkillDetails>(`/skills/${props.skill.id}`) : Promise.resolve(undefined)),
    () => [open, props.skill.currentVersionId]
  );
</script>

<li>
  <div class="row">
    <span class="grow">
      <strong>
        {props.skill.name}
      </strong>

      <span class:enabled={!props.skill.disabledAt} class="badge">
        {props.skill.disabledAt ? 'Disabled' : 'Enabled'}
      </span>

      <div class="muted small">
        {props.skill.description}
      </div>

      <DiscoverableToggle
        path={`/skills/${props.skill.id}`}
        discoverable={props.skill.discoverable}
        onChanged={props.onChanged}
      />
    </span>

    <button class="secondary" onclick={() => (open = !open)}>
      {#if open}
        Close
      {:else}
        Edit
      {/if}
    </button>

    <EnableButton
      path={`/skills/${props.skill.id}`}
      disabled={Boolean(props.skill.disabledAt)}
      onChanged={props.onChanged}
    />
  </div>

  {#if open && details.data}
    {#key details.data.currentVersionId}
      <SkillVersionForm
        skill={details.data}
        onSaved={() => (details.reload(), props.onChanged())}
      />
    {/key}
  {/if}
</li>
