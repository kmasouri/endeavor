import { api, getActorId, type AgentVersion } from '../api';

// Load every page so searches and task migration do not silently omit older records.
export async function loadAll<T>(path: string): Promise<T[]> {
  const actor = getActorId();
  const result: T[] = [];
  let offset = 0;
  while (actor === getActorId()) {
    const page = await api.list<T>(
      `${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`
    );
    result.push(...page.data);
    offset += page.data.length;
    if (!page.data.length || offset >= page.page.total) break;
  }
  return result;
}

export function listVersionChanges(next: AgentVersion, previous?: AgentVersion): string[] {
  if (!previous) return ['Created'];
  const changes: string[] = [];
  if (next.instructions !== previous.instructions) changes.push('Updated instructions');
  if (next.provider !== previous.provider) changes.push(`Switched provider to ${next.provider}`);
  if (next.model !== previous.model) changes.push(`Switched model to ${next.model}`);
  const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  if (!same(next.skillVersionIds, previous.skillVersionIds)) changes.push('Changed skills');
  if (!same(next.connectionIds, previous.connectionIds)) changes.push('Changed connections');
  const keys = ['maxModelTurns', 'maxTokens', 'maxCostUsd', 'maxWorkingMinutes'] as const;
  if (keys.some((key) => next.limits[key] !== previous.limits[key]))
    changes.push('Changed task limits');
  return changes.length ? changes : ['Configuration saved'];
}
