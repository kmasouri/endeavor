<script lang="ts">
  import { type TaskEvent } from '../api';

  let {
    event
  }: {
    event: TaskEvent;
  } = $props();
  let data = $derived(event.data);
  let text = $derived(
    (event.type === 'completion.checked' &&
      `${data.met ? 'Met' : 'Not met'}: ${String(data.summary ?? '')}`) ||
      (typeof data.reason === 'string' && data.reason) ||
      (typeof data.text === 'string' && data.text) ||
      (Array.isArray(data.toolCalls) &&
        data.toolCalls.map((call: { name?: string }) => call.name).join(', ')) ||
      (Array.isArray(data.results) &&
        data.results
          .map(
            (r: { content?: string; isError?: boolean }) =>
              `${r.isError ? 'Error: ' : ''}${r.content ?? ''}`
          )
          .join(' | ')
          .slice(0, 300)) ||
      (typeof data.to === 'string' && `→ ${data.to}`) ||
      ''
  );
</script>

{#if text}
  <div class="muted small">
    {text}
  </div>
{/if}
