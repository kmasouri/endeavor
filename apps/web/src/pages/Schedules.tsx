import { FormEvent, useState } from 'react';
import { Agent, api, Conversation, Responsibility, Task } from '../api';
import { ErrorNote, Hint, StateBadge, when } from '../components';
import { useAction, useLoad } from '../hooks';
import { useNames } from '../names';

export function SchedulesPage() {
  const schedules = useLoad(
    () => api.list<Responsibility>('/responsibilities?limit=100'),
    [],
    10000
  );
  const name = useNames();

  return (
    <div className="columns">
      <section>
        <h1>Schedules</h1>
        <Hint>
          A schedule is work an agent does again and again, with nobody asking each time. Each run
          is an ordinary task. Pausing or cancelling a schedule never stops a run that's already
          going; cancel that task separately.
        </Hint>
        <ErrorNote error={schedules.error} />
        {schedules.data?.data.length === 0 && <p className="muted">No schedules yet.</p>}
        {schedules.data?.data.map((schedule) => (
          <ScheduleCard
            key={schedule.id}
            schedule={schedule}
            agentName={name({ type: 'agent', id: schedule.agentId })}
            onChanged={schedules.reload}
          />
        ))}
      </section>
      <aside className="panel">
        <NewSchedule onCreated={schedules.reload} />
      </aside>
    </div>
  );
}

const POLICY_LABELS = {
  ask: 'run one, ask if several',
  run_once: 'run once',
  skip: 'skip'
} as const;

function ScheduleCard(props: {
  schedule: Responsibility;
  agentName: string;
  onChanged: () => void;
}) {
  const s = props.schedule;
  const [showRuns, setShowRuns] = useState(false);
  const [interval, setIntervalText] = useState(String(s.intervalMinutes));
  const runs = useLoad(
    () =>
      showRuns
        ? api.list<Task>(`/responsibilities/${s.id}/runs?limit=20`)
        : Promise.resolve({ data: [] as Task[], page: { limit: 0, offset: 0, total: 0 } }),
    [showRuns]
  );
  const action = useAction();
  const post = (path: string, body: unknown = {}) =>
    void action
      .run(() => api.post(`/responsibilities/${s.id}${path}`, body))
      .then((ok) => ok && (props.onChanged(), runs.reload()));
  const saveInterval = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() => api.patch(`/responsibilities/${s.id}`, { intervalMinutes: Number(interval) }))
      .then((ok) => ok && props.onChanged());
  };

  return (
    <div className="panel">
      <div className="row">
        <strong className="grow">{s.title}</strong>
        <span className={`badge ${s.status === 'enabled' ? 'state-working' : ''}`}>{s.status}</span>
      </div>
      {s.catchUp && (
        <div className="callout">
          <strong>
            {s.catchUp.missed === 1 ? 'A run was' : `${s.catchUp.missed} runs were`} missed while
            the platform was off.
          </strong>{' '}
          Run it now, or wait for the next one ({when(s.nextRunAt)})? If you don't answer, the next
          run happens as usual.
          <div className="row">
            <button disabled={action.busy} onClick={() => post('/catch-up', { decision: 'run' })}>
              Catch up now
            </button>
            <button
              className="secondary"
              disabled={action.busy}
              onClick={() => post('/catch-up', { decision: 'wait' })}
            >
              Wait
            </button>
          </div>
        </div>
      )}
      <p className="muted small">
        {props.agentName} · every {s.intervalMinutes} minutes ·{' '}
        {s.status === 'enabled' ? `next ${when(s.nextRunAt)}` : 'not running'}
        {s.lastRunAt && ` · last ${when(s.lastRunAt)}`} · missed runs:{' '}
        {POLICY_LABELS[s.missedRunPolicy]}
        {s.conversationId && (
          <>
            {' '}
            · <a href={`#/conversations/${s.conversationId}`}>results go here</a>
          </>
        )}
      </p>
      <details>
        <summary>Brief and criteria</summary>
        <p className="body small">{s.brief}</p>
        <p className="body small">
          <strong>Done when:</strong> {s.completionCriteria}
        </p>
      </details>
      {s.status !== 'cancelled' && (
        <div className="row wrap">
          {s.status === 'enabled' ? (
            <button className="secondary" disabled={action.busy} onClick={() => post('/pause')}>
              Pause
            </button>
          ) : (
            <button disabled={action.busy} onClick={() => post('/resume')}>
              Resume
            </button>
          )}
          <button className="secondary" disabled={action.busy} onClick={() => post('/runs', {})}>
            Run now
          </button>
          <button
            className="secondary"
            disabled={action.busy}
            onClick={() =>
              confirm('Cancel this schedule for good? Running work keeps going.') && post('/cancel')
            }
          >
            Cancel schedule
          </button>
          <form onSubmit={saveInterval} className="row">
            <input
              inputMode="numeric"
              value={interval}
              onChange={(e) => setIntervalText(e.target.value)}
              style={{ width: '5rem' }}
              aria-label="Interval in minutes"
            />
            <button
              className="secondary"
              disabled={action.busy || interval === String(s.intervalMinutes)}
            >
              Set minutes
            </button>
          </form>
        </div>
      )}
      <ErrorNote error={action.error} />
      <label className="check">
        <input type="checkbox" checked={showRuns} onChange={(e) => setShowRuns(e.target.checked)} />
        Show runs
      </label>
      {showRuns && (
        <ul className="list small">
          {(runs.data?.data ?? []).length === 0 && <li className="muted">No runs yet.</li>}
          {(runs.data?.data ?? []).map((run) => (
            <li key={run.id}>
              <a href={`#/tasks/${run.id}`}>{when(run.createdAt)}</a>{' '}
              <StateBadge state={run.state} paused={Boolean(run.pausedAt)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewSchedule({ onCreated }: { onCreated: () => void }) {
  const agents = useLoad(() => api.list<Agent>('/agents?limit=100'), []);
  const conversations = useLoad(() => api.list<Conversation>('/conversations?limit=100'), []);
  const [agentId, setAgentId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [criteria, setCriteria] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [policy, setPolicy] = useState<'ask' | 'run_once' | 'skip'>('ask');
  const action = useAction();

  const create = (event: FormEvent) => {
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
      .then((ok) => ok && (setTitle(''), setBrief(''), setCriteria(''), onCreated()));
  };

  return (
    <>
      <h2>New schedule</h2>
      <form onSubmit={create} className="stack">
        <label>
          Agent
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} required>
            <option value="">Choose…</option>
            {(agents.data?.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Post results in
          <Hint>The agent must already be in that conversation.</Hint>
          <select value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
            <option value="">(nowhere; see the task)</option>
            {(conversations.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          What to do each time
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} required />
        </label>
        <label>
          Done when
          <input value={criteria} onChange={(e) => setCriteria(e.target.value)} required />
        </label>
        <div className="grid2">
          <label>
            Every (minutes)
            <input
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label>
            If runs are missed
            <select
              value={policy}
              onChange={(e) => setPolicy(e.target.value as 'ask' | 'run_once' | 'skip')}
            >
              <option value="ask">Run one; ask me if several</option>
              <option value="run_once">Always run once when back</option>
              <option value="skip">Skip them</option>
            </select>
          </label>
        </div>
        <Hint>Runs are missed while this computer is asleep or the platform is stopped.</Hint>
        <button disabled={action.busy || !agentId}>Create schedule</button>
        <ErrorNote error={action.error} />
      </form>
    </>
  );
}
