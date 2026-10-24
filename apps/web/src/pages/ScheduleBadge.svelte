<script lang="ts">
  import type { Responsibility } from '../api';
  let { status }: { status: Responsibility['status'] } = $props();
</script>
<span class={`badge schedule-badge ${status}`}>
  <span aria-hidden="true">{status === 'enabled' ? '⊙' : status === 'paused' ? '⏸' : '⊘'}</span>
  {status === 'enabled' ? 'Enabled' : status === 'paused' ? 'Paused' : 'Cancelled'}
</span>
