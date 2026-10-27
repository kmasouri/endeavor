import { Task, TaskEvent } from '../../shared/types';
import { TASK_EVENTS } from './task-events';

export interface TaskActivity {
  kind: 'searching' | 'reading' | 'writing' | 'checking' | 'connection' | 'thinking';
  detail: string;
  since: Date;
}

export type ActiveTask = Task & { activity: TaskActivity | null };

// Ignore messages, costs, and other history that does not change the current step.
export const ACTIVITY_EVENTS = [
  TASK_EVENTS.created,
  TASK_EVENTS.resumed,
  TASK_EVENTS.stateChanged,
  TASK_EVENTS.modelStarted,
  TASK_EVENTS.modelTurn,
  TASK_EVENTS.modelFailed,
  TASK_EVENTS.toolStarted,
  TASK_EVENTS.toolResults
];

// Only describe known actions. Never copy request bodies, headers, or model text into status.
export function describeToolActivity(name: string, input: unknown): Omit<TaskActivity, 'since'> {
  const values = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const label = (key: string, fallback: string) =>
    typeof values[key] === 'string'
      ? (values[key] as string).replace(/\s+/g, ' ').trim().slice(0, 120) || fallback
      : fallback;
  switch (name) {
    case 'read_file':
      return { kind: 'reading', detail: `reading ${label('path', 'a workspace file')}` };
    case 'list_files':
      return { kind: 'searching', detail: 'looking through workspace files' };
    case 'find_capabilities':
      return { kind: 'searching', detail: 'finding available skills and connections' };
    case 'write_file':
      return { kind: 'writing', detail: `writing ${label('path', 'a workspace file')}` };
    case 'save_output':
      return { kind: 'writing', detail: `saving ${label('title', 'an output')}` };
    case 'send_message':
      return { kind: 'writing', detail: 'posting a message' };
    case 'save_note':
      return { kind: 'writing', detail: 'saving a note' };
    case 'complete_task':
      return { kind: 'checking', detail: 'checking completion criteria' };
    case 'http_request':
      return { kind: 'connection', detail: 'calling a connection' };
    default:
      return name.startsWith('mcp_')
        ? { kind: 'connection', detail: 'calling a connection' }
        : { kind: 'thinking', detail: 'preparing the next step' };
  }
}

export function deriveTaskActivity(task: Task, event?: TaskEvent): TaskActivity | null {
  if (task.pausedAt || task.state !== 'working') return null;
  const since = event?.createdAt ?? task.updatedAt;
  if (event?.type === TASK_EVENTS.toolStarted) {
    return { ...describeToolActivity(String(event.data.name ?? ''), event.data.input), since };
  }
  return {
    kind: 'thinking',
    detail:
      event?.type === TASK_EVENTS.modelFailed
        ? 'waiting to retry the model request'
        : 'considering the next step',
    since
  };
}
