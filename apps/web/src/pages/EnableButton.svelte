<script lang="ts">
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
      .then(props.onChanged)}
>
  {#if props.disabled}
    Enable
  {:else}
    Disable
  {/if}
</button>
