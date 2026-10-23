import { useState } from 'react';
import { api, Approval } from '../api';
import { ErrorNote, Hint, when } from '../components';
import { useLoad } from '../hooks';
import { useNames } from '../names';
import { ApprovalCard } from './Task';

export function ApprovalsPage() {
  const [showDecided, setShowDecided] = useState(false);
  const pending = useLoad(
    () => api.list<Approval>('/approvals?status=pending&limit=100'),
    [],
    4000
  );
  const decided = useLoad(
    () =>
      showDecided
        ? api.list<Approval>('/approvals?limit=100')
        : Promise.resolve({ data: [] as Approval[], page: { limit: 0, offset: 0, total: 0 } }),
    [showDecided]
  );
  const name = useNames();

  return (
    <div className="narrow wide">
      <h1>Approvals</h1>
      <Hint>
        Agents work on their own within their access. Some actions, set per connection, wait for a
        person first. The agent's task waits until you decide, and it's told your reason.
      </Hint>
      <ErrorNote error={pending.error} />
      {pending.data?.data.length === 0 && <p className="muted">Nothing waiting for you.</p>}
      {pending.data?.data.map((approval) => (
        <div key={approval.id} className="panel">
          <p className="muted small">
            {name({ type: 'agent', id: approval.agentId })} asked {when(approval.createdAt)} for{' '}
            <a href={`#/tasks/${approval.taskId}`}>this task</a>
          </p>
          <ApprovalCard approval={approval} onDone={() => (pending.reload(), decided.reload())} />
        </div>
      ))}

      <label className="check">
        <input
          type="checkbox"
          checked={showDecided}
          onChange={(e) => setShowDecided(e.target.checked)}
        />
        Show past decisions
      </label>
      {showDecided && (
        <ul className="list">
          {(decided.data?.data ?? [])
            .filter((a) => a.status !== 'pending')
            .map((approval) => (
              <li key={approval.id}>
                <strong>
                  {approval.request.method} {approval.request.path}
                </strong>{' '}
                on {approval.request.connectionName}{' '}
                <span className="badge">{approval.status}</span>
                <div className="muted small">
                  {name({ type: 'agent', id: approval.agentId })}
                  {approval.decidedAt && ` · decided ${when(approval.decidedAt)}`}
                  {approval.reason && ` · ${approval.reason}`}
                  {approval.result?.error && ` · not made: ${approval.result.error}`}
                  {approval.result?.status && ` · HTTP ${approval.result.status}`}
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
