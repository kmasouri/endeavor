<script lang="ts">
  import { api } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  // Discoverable entries can be found by agents, which can then ask a person for access.
  // Discovery grants nothing.
  let props: {
    path: string;
    discoverable: boolean;
    onChanged: () => void;
  } = $props();
  const action = createAction();
</script>

<label class="check small">
  <input
    type="checkbox"
    checked={props.discoverable}
    disabled={action.busy}
    onchange={(event) =>
      void action
        .run(() => api.patch(props.path, { discoverable: event.currentTarget.checked }))
        .then(props.onChanged)}
  />
  Agents can find this and ask for access
</label>
<ErrorNote error={action.error} />
