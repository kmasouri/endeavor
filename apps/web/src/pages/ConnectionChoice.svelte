<script lang="ts">
  import { type Connection } from '../api';
  import CheckGroup from '../CheckGroup.svelte';

  let props: {
    connections: Connection[];
    selected: string[];
    onChange: (ids: string[]) => void;
  } = $props();
</script>

<fieldset>
  <legend> Connections this skill uses </legend>

  <CheckGroup
    options={props.connections
      .filter((c) => !c.disabledAt)
      .map((c) => ({ value: c.id, label: c.name }))}
    selected={props.selected}
    onChange={props.onChange}
  />
</fieldset>
