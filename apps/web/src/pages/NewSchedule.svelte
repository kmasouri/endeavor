<script lang="ts">
  import { type Agent, api, type Conversation } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { when } from '../components';
  import { createAction, createLoad } from '../state.svelte';

  let {
    onCreated
  }: {
    onCreated: () => void;
  } = $props();
  const agents = createLoad(
    () => api.list<Agent>('/agents?limit=100'),
    () => []
  );
  const conversations = createLoad(
    () => api.list<Conversation>('/conversations?limit=100'),
    () => []
  );
  let agentId = $state('');
  let conversationId = $state('');
  let title = $state('');
  let brief = $state('');
  let criteria = $state('');
  let minutes = $state('60');
  let policy = $state<'ask' | 'run_once' | 'skip'>('ask');
  const action = createAction();
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    void action
      .run(() =>
        api.post('/responsibilities', {
          agentId,
          ...(conversationId && { conversationId }),
          title,
          brief,
          completionCriteria: criteria,
          intervalMinutes: Number(minutes),
          missedRunPolicy: policy
        })
      )
      .then((ok) => ok && ((title = ''), (brief = ''), (criteria = ''), onCreated()));
  };
</script>

<h2>New schedule</h2>

<form onsubmit={create} class="stack">
  <label>
    Agent

    <select bind:value={agentId} required>
      <option value=""> Choose… </option>

      {#each agents.data?.data ?? [] as a (a.id)}
        <option value={a.id}>
          {a.name}
        </option>
      {/each}
    </select>
  </label>

  <label>
    Post results in

    <Hint>The agent must already be in that conversation.</Hint>

    <select bind:value={conversationId}>
      <option value=""> (nowhere; see the task) </option>

      {#each conversations.data?.data ?? [] as c (c.id)}
        <option value={c.id}>
          {c.title}
        </option>
      {/each}
    </select>
  </label>

  <label>
    Title

    <input bind:value={title} required />
  </label>

  <label>
    What to do each time

    <textarea bind:value={brief} rows={3} required></textarea>
  </label>

  <label>
    Done when

    <input bind:value={criteria} required />
  </label>

  <div class="grid2">
    <label>
      Every (minutes)

      <input inputmode="numeric" bind:value={minutes} />
    </label>

    <label>
      If runs are missed

      <select
        value={policy}
        onchange={(e) => (policy = e.currentTarget.value as 'ask' | 'run_once' | 'skip')}
      >
        <option value="ask"> Run one; ask me if several </option>

        <option value="run_once"> Always run once when back </option>

        <option value="skip"> Skip them </option>
      </select>
    </label>
  </div>

  <Hint>Runs are missed while this computer is asleep or the platform is stopped.</Hint>

  <button disabled={action.busy || !agentId}> Create schedule </button>

  <ErrorNote error={action.error} />
</form>
