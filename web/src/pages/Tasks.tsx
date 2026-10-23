import { useState } from 'react';
import { api, Task, TASK_STATES, TaskState } from '../api';
import { ErrorNote, Hint, StateBadge, when } from '../components';
import { useLoad } from '../hooks';
import { useNames } from '../names';

export function TasksPage() {
  const [state, setState] = useState<TaskState | ''>('');
  const tasks = useLoad(
    () => api.list<Task>(`/tasks?limit=100${state ? `&state=${state}` : ''}`),
    [state],
    5000
  );
  const name = useNames();

  return (
    <div className="narrow wide">
      <h1>Work</h1>
      <Hint>
        Every piece of work is a task owned by one agent. Working, Waiting (for a reply, an
        approval, or a result), Blocked (needs a person), Completed, or Cancelled.
      </Hint>
      <label className="row">
        <span className="muted">Show</span>
        <select value={state} onChange={(event) => setState(event.target.value as TaskState | '')}>
          <option value="">all tasks</option>
          {TASK_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <ErrorNote error={tasks.error} />
      {tasks.data?.data.length === 0 && <p className="muted">No tasks.</p>}
      <ul className="list">
        {tasks.data?.data.map((task) => (
          <li key={task.id}>
            <a href={`#/tasks/${task.id}`}>
              <strong>{task.title}</strong>
            </a>{' '}
            <StateBadge state={task.state} paused={Boolean(task.pausedAt)} />
            <div className="muted small">
              {name({ type: 'agent', id: task.ownerAgentId })} · asked by{' '}
              {name({ type: task.requestedByType, id: task.requestedById })} ·{' '}
              {when(task.createdAt)}
              {task.stateReason && ` · ${task.stateReason}`}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
