import { FormEvent, useState } from 'react';
import { api, Conversation, DirectoryEntry } from '../api';
import { ErrorNote, Hint, when } from '../components';
import { go, useAction, useLoad } from '../hooks';

export function ConversationsPage() {
  const conversations = useLoad(() => api.list<Conversation>('/conversations?limit=100'), []);
  const directory = useLoad(() => api.get<DirectoryEntry[]>('/directory'), []);
  const [title, setTitle] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const action = useAction();

  const toggle = (id: string) =>
    setAgentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const start = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const created = await api.post<Conversation>('/conversations', { title, agentIds });
      go(`/conversations/${created.id}`);
    });
  };

  return (
    <div className="columns">
      <section>
        <h1>Conversations</h1>
        <ErrorNote error={conversations.error} />
        {conversations.data?.data.length === 0 && <p className="muted">No conversations yet.</p>}
        <ul className="list">
          {conversations.data?.data.map((conversation) => (
            <li key={conversation.id}>
              <a href={`#/conversations/${conversation.id}`}>{conversation.title}</a>
              <span className="muted"> · started {when(conversation.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>

      <aside className="panel">
        <h2>Start a conversation</h2>
        <form onSubmit={start} className="stack">
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <fieldset>
            <legend>Agents to add</legend>
            <Hint>
              You can add more later. Agents only answer when you mention them in a message.
            </Hint>
            {directory.data?.length === 0 && (
              <p className="muted">
                No agents yet. <a href="#/agents">Create one</a> first.
              </p>
            )}
            {directory.data?.map((agent) => (
              <label key={agent.id} className="check">
                <input
                  type="checkbox"
                  checked={agentIds.includes(agent.id)}
                  onChange={() => toggle(agent.id)}
                />
                <span>
                  <strong>{agent.name}</strong> <span className="muted">{agent.purpose}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <button disabled={action.busy || !title.trim()}>Start</button>
          <ErrorNote error={action.error ?? directory.error} />
        </form>
      </aside>
    </div>
  );
}
