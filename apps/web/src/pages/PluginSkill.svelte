<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Skill } from '../api';
  import { type PluginSkill } from '../plugin-package';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  let { skill, onDone }: { skill: PluginSkill; onDone: () => void } = $props();
  let imported = $state<Skill>();
  let discoverable = $state(true);
  const action = createAction();
  let active = true;
  onMount(() => () => { active = false; });

  const save = () => void action.run(async () => {
    const { name, description, instructions } = skill;
    const saved = await api.post<Skill>('/skills', { name, description, instructions, discoverable });
    if (!active) return;
    imported = saved;
    onDone();
  });
</script>

<section class="panel stack" aria-label={skill.name}>
  <h3>{skill.name}</h3>
  <p>{skill.description}</p>
  <details>
    <summary>Read instructions</summary>
    <pre>{skill.instructions}</pre>
  </details>
  {#if imported}
    <p role="status">Imported <a href={`#/skills/${imported.id}`}>{imported.name}</a>.</p>
  {:else}
    <label class="check">
      <input type="checkbox" bind:checked={discoverable} disabled={action.busy} />
      Let agents find this and request access
    </label>
    <ErrorNote error={action.error} />
    <div><button class="secondary" disabled={action.busy} onclick={save}>{action.busy ? 'Importing…' : 'Import skill'}</button></div>
  {/if}
</section>

<style>
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 20rem;
    overflow: auto;
  }
</style>
