import { FormEvent, useState } from 'react';
import { Agent, AgentVersion, api, Connection, Grant, Skill } from '../api';
import { ErrorNote, Hint, when } from '../components';
import { useAction, useLoad } from '../hooks';
import { AgentConfigFields, ConfigValues, initialConfig } from './AgentConfig';
import { SavedNotes } from './Context';

export function AgentPage({ agentId }: { agentId: string }) {
  const agent = useLoad(() => api.get<Agent>(`/agents/${agentId}`), [agentId]);
  const versions = useLoad(() => api.get<AgentVersion[]>(`/agents/${agentId}/versions`), [agentId]);
  const reloadAll = () => (agent.reload(), versions.reload());

  if (agent.error) {
    return <ErrorNote error={agent.error} />;
  }
  if (!agent.data) {
    return <p>Loading…</p>;
  }
  const a = agent.data;

  return (
    <div className="columns">
      <section>
        <p>
          <a href="#/agents">← Agents</a>
        </p>
        <h1>
          {a.name} {a.disabledAt && <span className="badge">disabled</span>}
        </h1>
        {!a.providerReady && (
          <p className="error">
            This agent's provider isn't set up, so its tasks can't run. Add the API key to .env and
            restart.
          </p>
        )}
        <Profile agent={a} onSaved={agent.reload} />
        {/* Remount the form when a new version is saved, so it starts from that version. */}
        <NewVersion key={a.currentVersionId ?? 'none'} agent={a} onSaved={reloadAll} />
        <div className="panel">
          <SavedNotes agentId={a.id} />
        </div>
      </section>

      <aside>
        <div className="panel">
          <EnableToggle agent={a} onChanged={agent.reload} />
        </div>
        <div className="panel">
          <Grants agentId={a.id} />
        </div>
        <div className="panel">
          <h2>Versions</h2>
          <Hint>
            Each task keeps the version it started with. Moving a task to a newer version is a
            separate, deliberate step.
          </Hint>
          <ul className="list">
            {(versions.data ?? []).map((version) => (
              <li key={version.id}>
                <strong>Version {version.version}</strong>
                {version.id === a.currentVersionId && <span className="badge"> current</span>}
                <div className="muted small">
                  {version.provider} {version.model} · {when(version.createdAt)}
                </div>
                <details>
                  <summary>Instructions</summary>
                  <p className="body small">{version.instructions}</p>
                </details>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Profile({ agent, onSaved }: { agent: Agent; onSaved: () => void }) {
  const [name, setName] = useState(agent.name);
  const [purpose, setPurpose] = useState(agent.purpose);
  const action = useAction();
  const changed = name !== agent.name || purpose !== agent.purpose;
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() => api.patch(`/agents/${agent.id}`, { name, purpose }))
      .then((ok) => ok && onSaved());
  };
  return (
    <form onSubmit={save} className="panel stack">
      <h2>Profile</h2>
      <Hint>Name and purpose aren't versioned. Changes show up everywhere at once.</Hint>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        Purpose
        <input value={purpose} onChange={(event) => setPurpose(event.target.value)} required />
      </label>
      <button disabled={action.busy || !changed}>Save profile</button>
      <ErrorNote error={action.error} />
    </form>
  );
}

function NewVersion({ agent, onSaved }: { agent: Agent; onSaved: () => void }) {
  const [config, setConfig] = useState<ConfigValues>(initialConfig(agent.currentVersion));
  const action = useAction();
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post(`/agents/${agent.id}/config`, config))
      .then((ok) => ok && onSaved());
  };
  return (
    <form onSubmit={save} className="panel stack">
      <h2>Configuration</h2>
      <Hint>
        Saving makes a new version. Only new tasks use it; work already running keeps its version.
      </Hint>
      <AgentConfigFields current={agent.currentVersion} onChange={setConfig} />
      <button disabled={action.busy || !config.instructions.trim()}>Save new version</button>
      <ErrorNote error={action.error} />
    </form>
  );
}

function EnableToggle({ agent, onChanged }: { agent: Agent; onChanged: () => void }) {
  const action = useAction();
  const verb = agent.disabledAt ? 'enable' : 'disable';
  return (
    <>
      <h2>{agent.disabledAt ? 'Disabled' : 'Enabled'}</h2>
      <Hint>
        A disabled agent takes no new tasks. Its open tasks keep going until a person pauses or
        cancels them.
      </Hint>
      <button
        className="secondary"
        disabled={action.busy}
        onClick={() =>
          void action.run(() => api.post(`/agents/${agent.id}/${verb}`)).then(onChanged)
        }
      >
        {agent.disabledAt ? 'Enable agent' : 'Disable agent'}
      </button>
      <ErrorNote error={action.error} />
    </>
  );
}

// Grants say which catalog entries this agent may use. Revoking takes effect on its very next
// tool call, even for tasks on older versions.
function Grants({ agentId }: { agentId: string }) {
  const grants = useLoad(() => api.get<Grant[]>(`/agents/${agentId}/grants`), [agentId]);
  const skills = useLoad(() => api.list<Skill>('/skills?limit=100'), []);
  const connections = useLoad(() => api.list<Connection>('/connections?limit=100'), []);
  const [choice, setChoice] = useState('');
  const action = useAction();

  const nameOf = (grant: Grant) =>
    (grant.targetType === 'skill'
      ? skills.data?.data.find((s) => s.id === grant.targetId)?.name
      : connections.data?.data.find((c) => c.id === grant.targetId)?.name) ?? grant.targetId;
  const granted = new Set((grants.data ?? []).map((g) => g.targetId));

  const grant = (event: FormEvent) => {
    event.preventDefault();
    const [type, id] = choice.split(':');
    void action
      .run(() => api.post(`/agents/${agentId}/grants`, { type, id }))
      .then((ok) => ok && (setChoice(''), grants.reload()));
  };

  return (
    <>
      <h2>Access</h2>
      <Hint>
        Being in a catalog gives no agent access. Access comes from these grants. Revoking takes
        effect on the agent's next tool call.
      </Hint>
      <ErrorNote error={grants.error} />
      <ul className="list">
        {(grants.data ?? []).length === 0 && <li className="muted">No access granted.</li>}
        {(grants.data ?? []).map((g) => (
          <li key={`${g.targetType}:${g.targetId}`} className="row">
            <span className="grow">
              {nameOf(g)} <span className="muted small">({g.targetType})</span>
            </span>
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() =>
                void action
                  .run(() => api.delete(`/agents/${agentId}/grants/${g.targetType}/${g.targetId}`))
                  .then(grants.reload)
              }
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={grant} className="row">
        <select className="grow" value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="">Grant access to…</option>
          {(skills.data?.data ?? [])
            .filter((s) => !granted.has(s.id) && !s.disabledAt)
            .map((s) => (
              <option key={s.id} value={`skill:${s.id}`}>
                Skill: {s.name}
              </option>
            ))}
          {(connections.data?.data ?? [])
            .filter((c) => !granted.has(c.id) && !c.disabledAt)
            .map((c) => (
              <option key={c.id} value={`connection:${c.id}`}>
                Connection: {c.name}
              </option>
            ))}
        </select>
        <button disabled={action.busy || !choice}>Grant</button>
      </form>
      <ErrorNote error={action.error} />
    </>
  );
}
