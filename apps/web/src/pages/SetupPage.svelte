<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import { api, type Human } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import { createAction } from '../state.svelte';

  let {
    people,
    onPeopleChanged
  }: {
    people: Human[];
    onPeopleChanged: () => void;
  } = $props();
  let name = $state('');
  const action = createAction();
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post('/humans', { name }))
      .then((ok) => ok && ((name = ''), onPeopleChanged()));
  };
</script>

<PageHeader title="Setup" subtitle="People, providers, and this computer." />

<div class="narrow">
  <section class="panel">
    <h2>How this runs</h2>

    <ul>
      <li>
        <strong> Everything runs on this computer: </strong>

        conversations, agents' work, schedules, and agents' tools. Agents' files stay in a private
        folder for each task.
      </li>

      <li>
        <strong> The AI models don't. </strong>

        Agents call them over the internet with the API key in your

        <code> .env </code>

        file, and connections reach the services you set up.
      </li>

      <li>
        <strong> Keep it awake. </strong>

        Agents only make progress while this computer is on, awake, and the platform is running.
        After a restart, work picks up where it left off.
      </li>

      <li>
        <strong> Closing this page doesn't stop anything. </strong>

        Work runs in the background, not in the browser.
      </li>
    </ul>
  </section>

  <section class="panel">
    <h2>People</h2>

    <p class="muted">
      For now there's one role: everyone can do everything. There's no sign-in, so only this
      computer can reach the platform.
    </p>

    <ul class="list">
      {#each people ?? [] as person (person.id)}
        <li>
          {person.name}
        </li>
      {/each}
    </ul>

    <form onsubmit={add} class="row">
      <input bind:value={name} placeholder="Name" required />

      <button disabled={action.busy || !name.trim()}> Add person </button>
    </form>

    <ErrorNote error={action.error} />
  </section>
</div>
