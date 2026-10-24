<script lang="ts">
  let {
    state,
    paused
  }: {
    state: string;
    paused?: boolean;
  } = $props();
</script>

<span class={`badge state-${paused ? 'paused' : state}`}
  >{paused ? 'Paused' : state === 'completed' ? 'Done' : state}</span
>
