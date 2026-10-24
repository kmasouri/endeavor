<script lang="ts">
  import { type Human } from './api';

  let {
    people,
    onPick
  }: {
    people: Human[];
    onPick: (id: string) => void;
  } = $props();
</script>

<main class="narrow">
  <h1>Who are you?</h1>

  <p class="muted">There's no sign-in yet. Pick yourself; this browser remembers the choice.</p>

  <ul class="choices">
    {#each people ?? [] as person (person.id)}
      <li>
        <button onclick={() => onPick(person.id)}>{person.name} </button>
      </li>
    {/each}
  </ul>
</main>
