<script lang="ts">
  import ErrorNote from '../ErrorNote.svelte';
  import { api } from '../api';
  import { createAction } from '../state.svelte';

  let props: {
    path: string;
    disabled: boolean;
    onChanged: () => void;
  } = $props();
  const action = createAction();
</script>

<button
  class="secondary"
  disabled={action.busy}
  onclick={() =>
    void action
      .run(() => api.post(`${props.path}/${props.disabled ? 'enable' : 'disable'}`))
      .then((ok) => ok && props.onChanged())}
>
  {#if props.disabled}
    Enable
  {:else}
    Disable
  {/if}
</button>

<ErrorNote error={action.error} />
