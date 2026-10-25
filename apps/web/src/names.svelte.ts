import { type Agent, api, type Human } from './api';
import { loadAll } from './pages/agent-data';
import { createLoad } from './state.svelte';

// Names for agents and people by ID, for pages that only have IDs (tasks, approvals, notes).
export function createNames(): (actor: { type: string; id: string | null }) => string {
  const agents = createLoad(
    () => loadAll<Agent>('/agents?includeDisabled=true'),
    () => []
  );
  const people = createLoad(
    () => api.get<Human[]>('/humans'),
    () => []
  );
  return (actor) => {
    if (actor.type === 'system' || actor.type === 'schedule') {
      return actor.type === 'schedule' ? 'Schedule' : 'Platform';
    }
    const list = actor.type === 'agent' ? agents.data : people.data;
    return (
      list?.find((item) => item.id === actor.id)?.name ??
      (actor.type === 'agent' && agents.data ? 'Deleted agent' : '…')
    );
  };
}
