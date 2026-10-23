import { FormEvent, useState } from 'react';
import { Agent, api } from '../api';
import { ErrorNote, Hint } from '../components';
import { go, useAction, useLoad } from '../hooks';
import { AgentConfigFields, ConfigValues, initialConfig } from './AgentConfig';

export function AgentsPage() {
  const agents = useLoad(() => api.list<Agent>('/agents?includeDisabled=true&limit=100'), []);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [config, setConfig] = useState<ConfigValues>(initialConfig());
  const action = useAction();

  const create = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const agent = await api.post<Agent>('/agents', { name, purpose, ...config });
      go(`/agents/${agent.id}`);
    });
  };

  return (
    <div className="columns">
      <section>
        <h1>Agents</h1>
        <Hint>
          An agent is a configured participant. A QA agent and a research agent are the same kind of
          thing with different settings, and no agent is in charge of another.
        </Hint>
        <ErrorNote error={agents.error} />
        {agents.data?.data.length === 0 && <p className="muted">No agents yet.</p>}
        <ul className="list">
          {agents.data?.data.map((agent) => (
            <li key={agent.id}>
              <a href={`#/agents/${agent.id}`}>
                <strong>{agent.name}</strong>
              </a>{' '}
              {agent.disabledAt && <span className="badge">disabled</span>}{' '}
              {!agent.providerReady && <span className="badge warn">provider not set up</span>}
              <div className="muted small">
                {agent.purpose}
                {agent.currentVersion &&
                  ` · ${agent.currentVersion.provider} ${agent.currentVersion.model} · version ${agent.currentVersion.version}`}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside className="panel">
        <h2>New agent</h2>
        <form onSubmit={create} className="stack">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Purpose
            <Hint>One line other participants see in the directory.</Hint>
            <input value={purpose} onChange={(event) => setPurpose(event.target.value)} required />
          </label>
          <AgentConfigFields onChange={setConfig} />
          <button disabled={action.busy || !name.trim() || !config.instructions.trim()}>
            Create agent
          </button>
          <ErrorNote error={action.error} />
        </form>
      </aside>
    </div>
  );
}
