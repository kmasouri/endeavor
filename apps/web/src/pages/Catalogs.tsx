import { FormEvent, useState } from 'react';
import { api, Connection, HTTP_METHODS, HttpMethod, Skill, SkillDetails } from '../api';
import { CheckGroup, ErrorNote, Hint } from '../components';
import { useAction, useLoad } from '../hooks';

export function CatalogsPage() {
  const skills = useLoad(() => api.list<Skill>('/skills?limit=100'), []);
  const connections = useLoad(() => api.list<Connection>('/connections?limit=100'), []);
  const connectionList = connections.data?.data ?? [];

  return (
    <div className="narrow wide">
      <h1>Skills and connections</h1>
      <Hint>
        These are shared catalogs. Adding something here gives no agent access: choose it in an
        agent's configuration, or grant it on the agent's page.
      </Hint>

      <section className="panel">
        <h2>Skills</h2>
        <Hint>
          A skill is a named set of instructions plus the connections it may use. Editing one saves
          a new version; agents keep the version they were set up with.
        </Hint>
        <ErrorNote error={skills.error} />
        <ul className="list">
          {(skills.data?.data ?? []).map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              connections={connectionList}
              onChanged={skills.reload}
            />
          ))}
        </ul>
        <NewSkill connections={connectionList} onCreated={skills.reload} />
      </section>

      <section className="panel">
        <h2>Connections</h2>
        <Hint>
          A connection is an outside API agents can call. The platform adds the credential and
          checks every call's method and path. Credentials are stored encrypted and never shown
          again.
        </Hint>
        <ErrorNote error={connections.error} />
        <ul className="list">
          {connectionList.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              onChanged={connections.reload}
            />
          ))}
        </ul>
        <NewConnection onCreated={connections.reload} />
      </section>
    </div>
  );
}

function EnableButton(props: { path: string; disabled: boolean; onChanged: () => void }) {
  const action = useAction();
  return (
    <button
      className="secondary"
      disabled={action.busy}
      onClick={() =>
        void action
          .run(() => api.post(`${props.path}/${props.disabled ? 'enable' : 'disable'}`))
          .then(props.onChanged)
      }
    >
      {props.disabled ? 'Enable' : 'Disable'}
    </button>
  );
}

function SkillRow(props: { skill: Skill; connections: Connection[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const details = useLoad(
    () => (open ? api.get<SkillDetails>(`/skills/${props.skill.id}`) : Promise.resolve(undefined)),
    [open, props.skill.currentVersionId]
  );
  return (
    <li>
      <div className="row">
        <span className="grow">
          <strong>{props.skill.name}</strong>{' '}
          {props.skill.disabledAt && <span className="badge">disabled</span>}
          <div className="muted small">{props.skill.description}</div>
        </span>
        <button className="secondary" onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Edit'}
        </button>
        <EnableButton
          path={`/skills/${props.skill.id}`}
          disabled={Boolean(props.skill.disabledAt)}
          onChanged={props.onChanged}
        />
      </div>
      {open && details.data && (
        <SkillVersionForm
          key={details.data.currentVersionId}
          skill={details.data}
          connections={props.connections}
          onSaved={() => (details.reload(), props.onChanged())}
        />
      )}
    </li>
  );
}

function SkillVersionForm(props: {
  skill: SkillDetails;
  connections: Connection[];
  onSaved: () => void;
}) {
  const [instructions, setInstructions] = useState(props.skill.currentVersion?.instructions ?? '');
  const [connectionIds, setConnectionIds] = useState(
    props.skill.currentVersion?.connectionIds ?? []
  );
  const action = useAction();
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post(`/skills/${props.skill.id}/versions`, { instructions, connectionIds }))
      .then((ok) => ok && props.onSaved());
  };
  return (
    <form onSubmit={save} className="stack">
      <span className="muted small">Version {props.skill.currentVersion?.version}</span>
      <textarea
        className="tall"
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        required
      />
      <ConnectionChoice
        connections={props.connections}
        selected={connectionIds}
        onChange={setConnectionIds}
      />
      <button disabled={action.busy}>Save new version</button>
      <ErrorNote error={action.error} />
    </form>
  );
}

function ConnectionChoice(props: {
  connections: Connection[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset>
      <legend>Connections this skill uses</legend>
      <CheckGroup
        options={props.connections
          .filter((c) => !c.disabledAt)
          .map((c) => ({ value: c.id, label: c.name }))}
        selected={props.selected}
        onChange={props.onChange}
      />
    </fieldset>
  );
}

function NewSkill(props: { connections: Connection[]; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const action = useAction();
  const create = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() => api.post('/skills', { name, description, instructions, connectionIds }))
      .then((ok) => {
        if (ok) {
          setName('');
          setDescription('');
          setInstructions('');
          setConnectionIds([]);
          props.onCreated();
        }
      });
  };
  return (
    <details>
      <summary>New skill</summary>
      <form onSubmit={create} className="stack">
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Description
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
        </label>
        <label>
          Instructions
          <textarea
            className="tall"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="How to do this kind of work, step by step."
            required
          />
        </label>
        <ConnectionChoice
          connections={props.connections}
          selected={connectionIds}
          onChange={setConnectionIds}
        />
        <button disabled={action.busy}>Create skill</button>
        <ErrorNote error={action.error} />
      </form>
    </details>
  );
}

const methodOptions = HTTP_METHODS.map((method) => ({ value: method, label: method }));

function ConnectionRow(props: { connection: Connection; onChanged: () => void }) {
  const c = props.connection;
  const [credential, setCredential] = useState('');
  const action = useAction();
  const setSecret = (value: string | null) =>
    void action
      .run(() => api.patch(`/connections/${c.id}`, { credential: value }))
      .then((ok) => ok && (setCredential(''), props.onChanged()));

  return (
    <li>
      <div className="row">
        <span className="grow">
          <strong>{c.name}</strong> {c.disabledAt && <span className="badge">disabled</span>}{' '}
          <span className="badge">{c.hasCredential ? 'credential saved' : 'no credential'}</span>
          <div className="muted small">
            {c.description} · {c.baseUrl}
          </div>
          <div className="muted small">
            Allowed: {c.allowedMethods.join(', ')} on {c.allowedPathPrefixes.join(', ')}
            {c.approvalMethods.length > 0 && ` · needs approval: ${c.approvalMethods.join(', ')}`}
          </div>
        </span>
        <EnableButton
          path={`/connections/${c.id}`}
          disabled={Boolean(c.disabledAt)}
          onChanged={props.onChanged}
        />
      </div>
      <details>
        <summary>Replace or remove the credential</summary>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            setSecret(credential);
          }}
        >
          <input
            className="grow"
            type="password"
            autoComplete="off"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder={`New value for the ${c.authHeader} header`}
          />
          <button disabled={action.busy || !credential}>Replace</button>
          {c.hasCredential && (
            <button
              type="button"
              className="secondary"
              disabled={action.busy}
              onClick={() => setSecret(null)}
            >
              Remove
            </button>
          )}
        </form>
        <ErrorNote error={action.error} />
      </details>
    </li>
  );
}

function NewConnection({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authHeader, setAuthHeader] = useState('Authorization');
  const [credential, setCredential] = useState('');
  const [allowedMethods, setAllowed] = useState<HttpMethod[]>(['GET']);
  const [prefixes, setPrefixes] = useState('/');
  // Reading is free; anything that changes something waits for a person, unless you say not.
  const [approvalMethods, setApproval] = useState<HttpMethod[]>(['POST', 'PUT', 'PATCH', 'DELETE']);
  const action = useAction();

  const create = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() =>
        api.post('/connections', {
          name,
          description,
          baseUrl,
          authHeader,
          ...(credential && { credential }),
          allowedMethods,
          allowedPathPrefixes: prefixes
            .split(/[\n,]/)
            .map((p) => p.trim())
            .filter(Boolean),
          approvalMethods: approvalMethods.filter((m) => allowedMethods.includes(m))
        })
      )
      .then((ok) => {
        if (ok) {
          setName('');
          setDescription('');
          setBaseUrl('');
          setCredential('');
          onCreated();
        }
      });
  };

  return (
    <details>
      <summary>New connection</summary>
      <form onSubmit={create} className="stack">
        <div className="grid2">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Base URL
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com"
              required
            />
          </label>
        </div>
        <label>
          Description
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
        </label>
        <div className="grid2">
          <label>
            Credential header
            <input value={authHeader} onChange={(event) => setAuthHeader(event.target.value)} />
          </label>
          <label>
            Credential
            <input
              type="password"
              autoComplete="off"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder="Bearer …"
            />
          </label>
        </div>
        <Hint>The credential is encrypted when saved, and never shown again, not even to you.</Hint>
        <div className="grid2">
          <fieldset>
            <legend>Allowed methods</legend>
            <CheckGroup options={methodOptions} selected={allowedMethods} onChange={setAllowed} />
          </fieldset>
          <fieldset>
            <legend>Need a person's approval</legend>
            <CheckGroup
              options={methodOptions.filter((o) => allowedMethods.includes(o.value))}
              selected={approvalMethods}
              onChange={setApproval}
            />
          </fieldset>
        </div>
        <label>
          Allowed paths
          <Hint>Path prefixes agents may call, one per line, like /v1/issues.</Hint>
          <textarea
            value={prefixes}
            onChange={(event) => setPrefixes(event.target.value)}
            rows={2}
          />
        </label>
        <button disabled={action.busy}>Create connection</button>
        <ErrorNote error={action.error} />
      </form>
    </details>
  );
}
