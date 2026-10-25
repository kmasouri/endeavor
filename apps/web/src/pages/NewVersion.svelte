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
    onSaved,
    onDiscard
  }: {
    agent: Agent;
    onSaved: () => void;
    onDiscard: () => void;
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

<form onsubmit={save} class="agent-form">
  <h2>Configuration</h2>

  <Hint>
    Saving makes a new version. Only new tasks use it. Removing skills or connections also stops
    open tasks from using them at their next call.
  </Hint>

  <AgentConfigFields current={agent.currentVersion} onChange={(value) => (config = value)} />

  <div class="savebar">
    <button type="button" class="secondary" disabled={action.busy} onclick={onDiscard}
      >Discard changes</button
    ><button disabled={action.busy || !config.instructions.trim() || !config.model.trim()}
      >Save new version</button
    >
  </div>

  <ErrorNote error={action.error} />
</form>
