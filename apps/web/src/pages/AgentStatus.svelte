<script lang="ts">
  import type { Agent } from '../api';
  let { agent }: { agent: Agent } = $props();
</script>

<span
  class="agent-status"
  class:enabled={!agent.disabledAt && agent.providerReady}
  class:setup={!agent.disabledAt && !agent.providerReady}
  >{agent.disabledAt ? 'Disabled' : agent.providerReady ? 'Enabled' : 'Needs setup'}</span
>
