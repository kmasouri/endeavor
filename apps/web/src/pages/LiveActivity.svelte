<script lang="ts">
  import { onMount } from 'svelte';
  import type { TaskActivity } from '../api';
  let { activity }: { activity: TaskActivity } = $props();
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const words = {
    searching: 'rummaging', reading: 'skimming', writing: 'scribbling',
    checking: 'fact-checking', connection: 'poking the API', thinking: 'mulling it over'
  };
  let seconds = $derived(Math.max(0, Math.floor((now - Date.parse(activity.since)) / 1000)));
</script>

is {words[activity.kind]}… <span class="muted">· {activity.detail}</span>
<span class="muted" aria-hidden="true"> · {seconds} s</span>
