<script lang="ts">
  import { type Agent, api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { createAction } from '../state.svelte';

  let {
    agent,
    onChanged
  }: {
    agent: Agent;
    onChanged: () => void;
  } = $props();
  const action = createAction();
  let verb = $derived(agent.disabledAt ? 'enable' : 'disable');
</script>

<h2>
  {#if agent.disabledAt}
    Disabled
  {:else}
    Enabled
  {/if}
</h2>

<Hint>
  A disabled agent takes no new tasks. Its open tasks keep going until a person pauses or cancels
  them.
</Hint>

<button
  class="secondary"
  disabled={action.busy}
  onclick={() => void action.run(() => api.post(`/agents/${agent.id}/${verb}`)).then(onChanged)}
>
  {#if agent.disabledAt}
    Enable agent
  {:else}
    Disable agent
  {/if}
</button>

<ErrorNote error={action.error} />
