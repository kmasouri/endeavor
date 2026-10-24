<script lang="ts">
  import { api, type Human } from './api';
  import ErrorNote from './ErrorNote.svelte';
  import { createAction } from './state.svelte';

  let {
    onCreated
  }: {
    onCreated: (human: Human) => void;
  } = $props();
  let name = $state('');
  const action = createAction();
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    void action.run(async () => onCreated(await api.post<Human>('/humans', { name })));
  };
</script>

<main class="narrow">
  <h1>Welcome</h1>

  <p>
    This platform runs on your computer. Agents' tools run here too, but the AI models they use are
    called over the internet with your API key. Agents only make progress while this computer is
    awake and the platform is running.
  </p>

  <form onsubmit={submit} class="stack">
    <label>
      Your name

      <input bind:value={name} required />
    </label>

    <button disabled={action.busy || !name.trim()}> Get started </button>

    <ErrorNote error={action.error} />
  </form>
</main>
