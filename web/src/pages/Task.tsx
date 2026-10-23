import { useState } from 'react';
import { AgentVersion, api, Approval, TaskDetails, TaskEvent, TaskOutput } from '../api';
import { ErrorNote, Hint, StateBadge, when } from '../components';
import { go, useAction, useLoad } from '../hooks';
import { useNames } from '../names';

export function TaskPage({ taskId }: { taskId: string }) {
  const task = useLoad(() => api.get<TaskDetails>(`/tasks/${taskId}`), [taskId], 4000);
  const outputs = useLoad(() => api.get<TaskOutput[]>(`/tasks/${taskId}/outputs`), [taskId], 4000);
  const events = useLoad(
    () => api.get<TaskEvent[]>(`/tasks/${taskId}/events?limit=500`),
    [taskId],
    4000
  );
  const versions = useLoad(
    () =>
      task.data
        ? api.get<AgentVersion[]>(`/agents/${task.data.ownerAgentId}/versions`)
        : Promise.resolve([]),
    [task.data?.ownerAgentId]
  );
  const name = useNames();

  if (task.error) {
    return <ErrorNote error={task.error} />;
  }
  if (!task.data) {
    return <p>Loading…</p>;
  }
  const t = task.data;
  const version = versions.data?.find((v) => v.id === t.agentVersionId);
  const latest = versions.data?.[0];
  const reload = () => (task.reload(), events.reload(), outputs.reload());

  return (
    <div className="columns">
      <section>
        <p>
          <a href="#/tasks">← Work</a>
        </p>
        <h1>
          {t.title} <StateBadge state={t.state} paused={Boolean(t.pausedAt)} />
        </h1>
        {t.stateReason && (
          <p className={t.state === 'blocked' ? 'error' : 'muted'}>{t.stateReason}</p>
        )}

        <div className="panel">
          <h2>The request</h2>
          <p className="body">{t.brief}</p>
          <h3>Done when</h3>
          <p className="body">{t.completionCriteria}</p>
          {t.criteriaCheck && (
            <>
              <h3>Agent's check against the criteria</h3>
              <p className="body">
                {t.criteriaCheck.met ? 'Met. ' : 'Not met. '}
                {t.criteriaCheck.summary}
              </p>
            </>
          )}
          {t.review && (
            <p className="muted">
              Reviewed: {t.review.approved ? 'approved' : 'sent back'}
              {t.review.notes && ` (${t.review.notes})`}
            </p>
          )}
        </div>

        <OpenConcerns task={t} events={events.data ?? []} />
        <ReviewPanel task={t} onDone={reload} />

        <div className="panel">
          <h2>Outputs and evidence</h2>
          {(outputs.data ?? []).length === 0 && <p className="muted">Nothing attached yet.</p>}
          {(outputs.data ?? []).map((output) => (
            <div key={output.id}>
              <strong>{output.title}</strong> <span className="badge">{output.kind}</span>{' '}
              <span className="muted small">{when(output.createdAt)}</span>
              {output.uri && (
                <div>
                  <a href={output.uri} target="_blank" rel="noreferrer">
                    {output.uri}
                  </a>
                </div>
              )}
              {output.content && <pre>{output.content}</pre>}
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>History</h2>
          <Hint>
            Everything that happened, oldest first: state changes, model turns, and tool calls.
          </Hint>
          <ol className="events">
            {(events.data ?? []).map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong>{' '}
                <span className="muted small">
                  {name(event.actor)} · {when(event.createdAt)}
                </span>
                <EventDetail event={event} />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <aside>
        <div className="panel">
          <h2>About</h2>
          <ul className="list small">
            <li>
              Owner:{' '}
              <a href={`#/agents/${t.ownerAgentId}`}>
                {name({ type: 'agent', id: t.ownerAgentId })}
              </a>
            </li>
            <li>
              Configuration: version {version?.version ?? '…'}
              {latest && version && latest.id !== version.id && (
                <span className="muted"> (the agent is now on version {latest.version})</span>
              )}
            </li>
            <li>
              Asked by: {name({ type: t.requestedByType, id: t.requestedById })},{' '}
              {when(t.createdAt)}
            </li>
            {t.conversationId && (
              <li>
                <a href={`#/conversations/${t.conversationId}`}>Open the conversation</a>
              </li>
            )}
            {t.parentTaskId && (
              <li>
                Helping with <a href={`#/tasks/${t.parentTaskId}`}>another task</a>
              </li>
            )}
            {t.restartedFromTaskId && (
              <li>
                Restarted from <a href={`#/tasks/${t.restartedFromTaskId}`}>an earlier run</a>
              </li>
            )}
            {t.responsibilityId && (
              <li>
                A run of a <a href="#/schedules">schedule</a>
              </li>
            )}
          </ul>
        </div>

        <Controls task={t} latestVersionId={latest?.id} onDone={reload} />

        <div className="panel">
          <h2>Waiting on</h2>
          {t.waits.length === 0 && <p className="muted">Nothing.</p>}
          <ul className="list small">
            {t.waits.map((wait) => (
              <li key={wait.id}>
                {wait.description} <span className="badge">{wait.kind}</span>
                <div className="muted">
                  {wait.resolvedAt
                    ? `Done ${when(wait.resolvedAt)}`
                    : `Since ${when(wait.createdAt)}`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function EventDetail({ event }: { event: TaskEvent }) {
  const data = event.data;
  const text =
    (event.type === 'completion.checked' &&
      `${data.met ? 'Met' : 'Not met'}: ${String(data.summary ?? '')}`) ||
    (typeof data.reason === 'string' && data.reason) ||
    (typeof data.text === 'string' && data.text) ||
    (Array.isArray(data.toolCalls) &&
      data.toolCalls.map((call: { name?: string }) => call.name).join(', ')) ||
    (Array.isArray(data.results) &&
      data.results
        .map(
          (r: { content?: string; isError?: boolean }) =>
            `${r.isError ? 'Error: ' : ''}${r.content ?? ''}`
        )
        .join(' | ')
        .slice(0, 300)) ||
    (typeof data.to === 'string' && `→ ${data.to}`) ||
    '';
  return text ? <div className="muted small">{text}</div> : null;
}

// Gaps the completion check found that haven't been fixed yet, so people see what's unresolved.
function OpenConcerns({ task, events }: { task: TaskDetails; events: TaskEvent[] }) {
  const checks = events.filter((event) => event.type === 'completion.checked');
  const last = checks[checks.length - 1];
  if (!last || last.data.met === true || task.state === 'completed') {
    return null;
  }
  return (
    <div className="panel">
      <h2>Open concerns</h2>
      <Hint>
        The completion check found gaps in the agent's last result. The agent is told; you can add
        guidance in the conversation.
      </Hint>
      <p className="body error">{String(last.data.summary ?? '')}</p>
    </div>
  );
}

// A result that needs review waits for a person to approve it or send it back.
function ReviewPanel({ task, onDone }: { task: TaskDetails; onDone: () => void }) {
  const [notes, setNotes] = useState('');
  const action = useAction();
  const waiting =
    task.reviewRequired && task.state === 'waiting' && task.criteriaCheck && !task.review;
  if (!waiting) {
    return null;
  }
  const review = (approved: boolean) =>
    void action
      .run(() => api.post(`/tasks/${task.id}/review`, { approved, ...(notes && { notes }) }))
      .then((ok) => ok && onDone());
  return (
    <div className="panel">
      <h2>Ready for your review</h2>
      <Hint>The result is posted to the conversation once you approve it.</Hint>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
      />
      <div className="row">
        <button disabled={action.busy} onClick={() => review(true)}>
          Approve
        </button>
        <button className="secondary" disabled={action.busy} onClick={() => review(false)}>
          Send back
        </button>
      </div>
      <ErrorNote error={action.error} />
    </div>
  );
}

function Controls(props: { task: TaskDetails; latestVersionId?: string; onDone: () => void }) {
  const t = props.task;
  const [reason, setReason] = useState('');
  const action = useAction();
  const finished = t.state === 'completed' || t.state === 'cancelled';
  const act = (path: string) =>
    void action
      .run(async () => {
        // Restart answers with the new run, which is a separate task.
        const result = await api.post<{ id: string }>(
          `/tasks/${t.id}/${path}`,
          reason ? { reason } : {}
        );
        if (path === 'restart') {
          go(`/tasks/${result.id}`);
        }
      })
      .then((ok) => ok && (setReason(''), props.onDone()));

  return (
    <div className="panel stack">
      <h2>Direct this work</h2>
      <Hint>
        To add information or redirect it, write to the agent in the conversation. These buttons
        stop or start the work itself.
      </Hint>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={finished ? 'What should change? (for Ask for changes)' : 'Reason (optional)'}
      />
      <div className="row wrap">
        {!finished && !t.pausedAt && (
          <button className="secondary" disabled={action.busy} onClick={() => act('pause')}>
            Pause
          </button>
        )}
        {!finished && (t.pausedAt || t.state === 'blocked') && (
          <button disabled={action.busy} onClick={() => act('resume')}>
            Resume
          </button>
        )}
        {!finished && (
          <button className="secondary" disabled={action.busy} onClick={() => act('cancel')}>
            Cancel
          </button>
        )}
        {finished && (
          <button
            disabled={action.busy || !reason.trim()}
            title="Write what to change in the box above"
            onClick={() => act('restart')}
          >
            Ask for changes
          </button>
        )}
        {finished && (
          <button className="secondary" disabled={action.busy} onClick={() => act('restart')}>
            Restart as a new run
          </button>
        )}
        {!finished && props.latestVersionId && props.latestVersionId !== t.agentVersionId && (
          <button className="secondary" disabled={action.busy} onClick={() => act('version')}>
            Move to the agent's newest version
          </button>
        )}
      </div>
      <ErrorNote error={action.error} />
      <PendingApprovals taskId={t.id} onDone={props.onDone} />
    </div>
  );
}

function PendingApprovals({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const approvals = useLoad(
    () => api.list<Approval>('/approvals?status=pending&limit=100'),
    [],
    4000
  );
  const mine = (approvals.data?.data ?? []).filter((a) => a.taskId === taskId);
  if (mine.length === 0) {
    return null;
  }
  return (
    <>
      <h3>Needs your approval</h3>
      {mine.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          onDone={() => (approvals.reload(), onDone())}
        />
      ))}
    </>
  );
}

export function ApprovalCard({ approval, onDone }: { approval: Approval; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const action = useAction();
  const decide = (verb: 'approve' | 'reject') =>
    void action
      .run(() => api.post(`/approvals/${approval.id}/${verb}`, reason ? { reason } : {}))
      .then((ok) => ok && onDone());
  const r = approval.request;
  return (
    <div className="stack">
      <div>
        <strong>
          {r.method} {r.path}
        </strong>{' '}
        on {r.connectionName}
      </div>
      {r.body && <pre>{r.body}</pre>}
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
      />
      <div className="row">
        <button disabled={action.busy} onClick={() => decide('approve')}>
          Approve
        </button>
        <button className="secondary" disabled={action.busy} onClick={() => decide('reject')}>
          Reject
        </button>
      </div>
      <ErrorNote error={action.error} />
    </div>
  );
}
