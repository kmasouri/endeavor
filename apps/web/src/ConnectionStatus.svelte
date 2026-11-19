<script lang="ts">
  import type { Connection } from './api';
  import { authenticationMethod, isAuthenticated } from './connection-auth';
  let { connection }: { connection: Connection } = $props();
  const needsAuthentication = $derived(
    !connection.disabledAt && authenticationMethod(connection) !== 'none' && !isAuthenticated(connection)
  );
</script>

<span class="management-status" class:enabled={!connection.disabledAt && !needsAuthentication} class:auth-required={needsAuthentication}>
  {connection.disabledAt ? 'Disabled' : needsAuthentication ? 'Authentication required' : 'Enabled'}
</span>
