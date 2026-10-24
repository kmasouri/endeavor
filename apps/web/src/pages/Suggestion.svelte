<script lang="ts">
  import { type DirectoryEntry, type Member, type Message } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  const SUGGESTION = /^Suggestion: add (.+?) \(/;

  let props: {
    message: Message;
    members: Member[];
    directory: DirectoryEntry[];
    onAdd: (agentId: string) => Promise<unknown>;
  } = $props();
  const action = createAction();
  let name = $derived(
    props.message.authorType === 'agent' && SUGGESTION.exec(props.message.body)?.[1]
  );
  let agent = $derived(name ? props.directory.find((entry) => entry.name === name) : undefined);
  let added = $derived(props.members.some((m) => m.participant.id === agent?.id));


</script>

{#if agent}
  <div class="suggestion">
    {#if added}
      <span class="muted">{agent.name} is in this conversation.</span>
    {:else}
      <button disabled={action.busy} onclick={() => void action.run(() => props.onAdd(agent.id))}>
        Add {agent.name}
      </button>
    {/if}

    <ErrorNote error={action.error} />
  </div>
{/if}
