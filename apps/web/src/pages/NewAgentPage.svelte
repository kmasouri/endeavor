<script lang="ts">
  import { untrack } from 'svelte';
  import PageHeader from '../PageHeader.svelte';
  import ErrorNote from '../ErrorNote.svelte';
  import { api, type Agent } from '../api';
  import { createAction, go } from '../state.svelte';
  import AgentConfigFields from './AgentConfigFields.svelte';
  import { initialConfig, type ConfigValues } from './AgentConfig';
  import './agents.css';
  import { codingExamples } from './coding-examples';
  const example = new URLSearchParams(window.location.hash.split('?')[1]).get('example');
  const examples = {
    ...codingExamples,
    researcher: {
      name: 'Researcher',
      purpose: 'Finds and summarizes sources on a question, citing each claim.',
      instructions:
        'Answer with a short summary. Cite a source for every claim. Ask a clarifying question when the request is unclear.'
    },
    qa: {
      name: 'QA',
      purpose: 'Tests the staging site and reports failures with steps to reproduce.',
      instructions:
        'Test the staging site. Report failures with steps to reproduce, expected behavior, and evidence. Ask for the site and access details before starting.'
    }
  };
  const preset = example && Object.hasOwn(examples, example) ? examples[example as keyof typeof examples] : undefined;
  let name = $state(preset?.name ?? '');
  let purpose = $state(preset?.purpose ?? '');
  let produces = $state('');
  let needs = $state('');
  let config = $state<ConfigValues>({
    ...initialConfig(),
    instructions: preset?.instructions ?? ''
  });
  const initial = untrack(() => ({ ...config }));
  const action = createAction();
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const agent = await api.post<Agent>('/agents', { name, purpose, produces: produces.trim() || null, needs: needs.trim() || null, ...config });
      go(`/agents/${agent.id}`);
    });
  };
</script>

<div class="agents-page creation-page">
  <a class="creation-back" href="#/agents">← Agents</a>
  <PageHeader
    title="New agent"
    subtitle="Give it a purpose, instructions, and a model. You can change these later."
  />
  <form class="creation-form" onsubmit={create}>
    <fieldset class="stack">
      <legend>Profile</legend>
      <p class="caption">Examples: <a href="#/agents/new?example=coder">Coding agent</a> · <a href="#/agents/new?example=reviewer">Code reviewer</a></p>
      <label>Name<input bind:value={name} required /></label><label
        >Purpose<input bind:value={purpose} required /></label
      >
      <label>Produces<textarea bind:value={produces} maxlength={500} rows={2}></textarea><small class="muted">Optional. What this agent hands back. Up to 500 characters.</small></label>
      <label>Needs<textarea bind:value={needs} maxlength={500} rows={2}></textarea><small class="muted">Optional. The input this agent needs. Up to 500 characters.</small></label>
    </fieldset>
    <AgentConfigFields {initial} onChange={(values) => (config = values)} />
    <ErrorNote error={action.error} />
    <div class="savebar">
      <a href="#/agents">Cancel</a><button
        disabled={action.busy ||
          !name.trim() ||
          !purpose.trim() ||
          !config.instructions.trim() ||
          !config.model.trim()}>Create agent</button
      >
    </div>
  </form>
</div>
