import { Task, TaskEvent } from '../../shared/types';
import { deriveTaskActivity, describeToolActivity } from './task-activity';

const since = new Date('2026-10-27T12:00:00Z');
const task = { id: 'task', state: 'working', pausedAt: null, updatedAt: since } as Task;
const event = (type: string, data = {}): TaskEvent => ({
  id: 20,
  taskId: task.id,
  type,
  data,
  actor: { type: 'system', id: null },
  createdAt: since
});

describe('task activity', () => {
  it.each([
    ['read_file', { path: 'sources/heat-pump.md' }, 'reading', 'reading sources/heat-pump.md'],
    ['write_file', { path: 'draft.md' }, 'writing', 'writing draft.md'],
    ['list_files', {}, 'searching', 'looking through workspace files'],
    ['find_capabilities', {}, 'searching', 'finding available skills and connections'],
    ['save_output', { title: 'Research brief' }, 'writing', 'saving Research brief'],
    ['complete_task', {}, 'checking', 'checking completion criteria'],
    [
      'http_request',
      { headers: { Authorization: 'secret' }, body: 'private' },
      'connection',
      'calling a connection'
    ],
    ['mcp_opaque', { query: 'private search' }, 'connection', 'calling a connection']
  ])('derives %s without exposing unrelated arguments', (name, input, kind, detail) => {
    expect(deriveTaskActivity(task, event('tool.started', { name, input }))).toEqual({
      kind,
      detail,
      since
    });
  });

  it('keeps the event timestamp across polls', () => {
    const activity = deriveTaskActivity({ ...task, updatedAt: new Date() }, event('model.started'));
    expect(activity).toEqual({ kind: 'thinking', detail: 'considering the next step', since });
  });

  it.each(['waiting', 'blocked', 'completed', 'cancelled'] as const)(
    'clears old activity when %s',
    (state) => {
      expect(
        deriveTaskActivity({ ...task, state }, event('tool.started', { name: 'read_file' }))
      ).toBeNull();
    }
  );

  it('clears activity when paused and falls back for old tasks', () => {
    expect(deriveTaskActivity({ ...task, pausedAt: since }, event('model.started'))).toBeNull();
    expect(deriveTaskActivity(task)).toMatchObject({ kind: 'thinking', since });
    expect(deriveTaskActivity(task, event('tool.results'))?.kind).toBe('thinking');
    expect(deriveTaskActivity(task, event('model.failed'))?.detail).toBe(
      'waiting to retry the model request'
    );
  });

  it('bounds labels and handles missing or malformed tool arguments', () => {
    expect(describeToolActivity('read_file', null).detail).toBe('reading a workspace file');
    expect(describeToolActivity('save_output', { title: 20 }).detail).toBe('saving an output');
    expect(describeToolActivity('read_file', { path: 'a'.repeat(500) }).detail.length).toBe(128);
    expect(describeToolActivity('unknown', { body: 'secret' })).toEqual({
      kind: 'thinking',
      detail: 'preparing the next step'
    });
  });
});
