<script lang="ts">
  import { untrack } from 'svelte';
  import { type Agent, api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction } from '../state.svelte';
  import AgentConfigFields from './AgentConfigFields.svelte';
  import { type ConfigValues, initialConfig } from './AgentConfig';

  let {
    agent,
    onSaved
  }: {
    agent: Agent;
    onSaved: () => void;
  } = $props();
  let config = $state<ConfigValues>(untrack(() => initialConfig(agent.currentVersion)));
  const action = createAction();
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post(`/agents/${agent.id}/config`, config))
      .then((ok) => ok && onSaved());
  };
</script>

<form onsubmit={save} class="panel stack">
  <h2>Configuration</h2>

  <Hint>
    Saving makes a new version. Only new tasks use it; work already running keeps its version.
  </Hint>

  <AgentConfigFields current={agent.currentVersion} onChange={(value) => (config = value)} />

  <button disabled={action.busy || !config.instructions.trim()}> Save new version </button>

  <ErrorNote error={action.error} />
</form>
