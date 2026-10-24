import type { TaskEvent } from './api';

export interface AgentStep {
  id: string;
  title: string;
  detail?: string;
  kind: 'search' | 'read' | 'request' | 'output' | 'status' | 'error';
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const short = (value: string): string => {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > 180 ? line.slice(0, 177) + '…' : line;
};

// Summarize recorded actions, never model reasoning or raw tool response bodies.
export function agentSteps(events: TaskEvent[]): AgentStep[] {
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const steps: AgentStep[] = [];
  for (const event of events) {
    const data = event.data;
    if (event.type === 'model.turn' && Array.isArray(data.toolCalls)) {
      for (const value of data.toolCalls) {
        const call = record(value);
        if (typeof call.id === 'string')
          calls.set(call.id, { name: text(call.name), input: record(call.input) });
      }
    } else if (event.type === 'connection.called') {
      const call = calls.get(text(data.callId));
      const source = short(text(call?.input.connection)) || 'external service';
      const path = text(data.path);
      const method = text(data.method).toUpperCase();
      const failed = typeof data.status === 'number' && data.status >= 400;
      let kind: AgentStep['kind'] = method === 'GET' ? 'read' : 'request';
      let title = method === 'GET' ? `Read from ${source}` : `Called ${source}`;
      try {
        const url = new URL(path, 'https://local.invalid');
        const query = url.searchParams.get('srsearch');
        const pages = url.searchParams.get('titles');
        if (method === 'GET' && query) {
          kind = 'search';
          title = `Searched for “${short(query)}”`;
        } else if (method === 'GET' && pages)
          title = `Read ${short(pages.replace(/_/g, ' ').replace(/\|/g, ', '))}`;
      } catch {
        /* A generic recorded request is still useful when its path is unusual. */
      }
      steps.push({
        id: String(event.id),
        kind: failed ? 'error' : kind,
        title: failed ? `Request to ${source} failed` : title,
        detail: failed ? `HTTP ${data.status}` : source
      });
    } else if (event.type === 'task.output.added' && text(data.title) && data.title !== 'Result') {
      steps.push({
        id: String(event.id),
        kind: 'output',
        title: `Saved ${short(text(data.title))}`
      });
    } else if (event.type === 'tool.results' && Array.isArray(data.results)) {
      for (const [index, value] of data.results.entries()) {
        const result = record(value);
        const call = calls.get(text(result.callId));
        if (result.isError === true)
          steps.push({
            id: `${event.id}:${index}`,
            kind: 'error',
            title: 'A step could not be completed',
            detail: 'Open the full run for details.'
          });
        else if (call?.name === 'ask' && text(call.input.to))
          steps.push({
            id: `${event.id}:${index}`,
            kind: 'status',
            title: `Asked ${short(text(call.input.to))} for help`
          });
      }
    } else if (event.type === 'task.wait.resolved' && data.kind === 'reply') {
      steps.push({ id: String(event.id), kind: 'status', title: 'Received a reply' });
    } else if (event.type === 'completion.checked') {
      steps.push({
        id: String(event.id),
        kind: 'status',
        title: 'Checked completion criteria',
        detail: short(text(data.summary))
      });
    } else if (event.type === 'task.state.changed') {
      const labels: Record<string, string> = {
        completed: 'Completed the work',
        cancelled: 'Stopped the work',
        blocked: 'Work needs attention'
      };
      const label = labels[text(data.to)];
      if (label)
        steps.push({
          id: String(event.id),
          kind: data.to === 'blocked' ? 'error' : 'status',
          title: label,
          detail: short(text(data.reason)) || undefined
        });
    }
  }
  return steps;
}
