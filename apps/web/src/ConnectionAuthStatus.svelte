<script lang="ts">
  import type { Connection } from './api';
  import { authenticationMethod, isAuthenticated } from './connection-auth';
  let { connection }: { connection: Connection } = $props();
</script>

{#if authenticationMethod(connection) !== 'none'}
  <span class="management-status" class:enabled={isAuthenticated(connection)} class:auth-required={!isAuthenticated(connection)}>
    {isAuthenticated(connection) ? 'Authenticated' : 'Authentication required'}
  </span>
{/if}
