<script lang="ts">
  import { api, type Conversation, type DirectoryEntry } from '../api';
  import ErrorNote from '../ErrorNote.svelte';
  import Hint from '../Hint.svelte';
  import { when } from '../components';
  import { go, createAction, createLoad } from '../state.svelte';

  const conversations = createLoad(
    () => api.list<Conversation>('/conversations?limit=100'),
    () => []
  );
  const directory = createLoad(
    () => api.get<DirectoryEntry[]>('/directory'),
    () => []
  );
  let title = $state('');
  let agentIds = $state<string[]>([]);
  const action = createAction();
  const toggle = (id: string) => {
    agentIds = agentIds.includes(id) ? agentIds.filter((value) => value !== id) : [...agentIds, id];
  };
  const start = (event: SubmitEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const created = await api.post<Conversation>('/conversations', { title, agentIds });
      go(`/conversations/${created.id}`);
    });
  };
</script>

<div class="columns">
  <section>
    <h1>Conversations</h1>

    <ErrorNote error={conversations.error} />

    {#if conversations.data?.data.length === 0}
      <p class="muted">No conversations yet.</p>
    {/if}

    <ul class="list">
      {#each conversations.data?.data ?? [] as conversation (conversation.id)}
        <li>
          <a href={`#/conversations/${conversation.id}`}>
            {conversation.title}
          </a>

          <span class="muted">
            · started {when(conversation.createdAt)}
          </span>
        </li>
      {/each}
    </ul>
  </section>

  <aside class="panel">
    <h2>Start a conversation</h2>

    <form onsubmit={start} class="stack">
      <label>
        Title

        <input bind:value={title} required />
      </label>

      <fieldset>
        <legend> Agents to add </legend>

        <Hint>You can add more later. Agents only answer when you mention them in a message.</Hint>

        {#if directory.data?.length === 0}
          <p class="muted">
            No agents yet.

            <a href="#/agents"> Create one </a>

            first.
          </p>
        {/if}

        {#each directory.data ?? [] as agent (agent.id)}
          <label class="check">
            <input
              type="checkbox"
              checked={agentIds.includes(agent.id)}
              oninput={() => toggle(agent.id)}
            />

            <span>
              <strong>
                {agent.name}
              </strong>

              <span class="muted">
                {agent.purpose}
              </span>
            </span>
          </label>
        {/each}
      </fieldset>

      <button disabled={action.busy || !title.trim()}> Start </button>

      <ErrorNote error={action.error ?? directory.error} />
    </form>
  </aside>
</div>
