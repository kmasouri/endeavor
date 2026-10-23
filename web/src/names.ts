import { Agent, api, Human } from './api';
import { useLoad } from './hooks';

// Names for agents and people by ID, for pages that only have IDs (tasks, approvals, notes).
export function useNames(): (actor: { type: string; id: string | null }) => string {
  const agents = useLoad(() => api.list<Agent>('/agents?includeDisabled=true&limit=100'), []);
  const people = useLoad(() => api.get<Human[]>('/humans'), []);
  return (actor) => {
    if (actor.type === 'system' || actor.type === 'schedule') {
      return actor.type === 'schedule' ? 'Schedule' : 'Platform';
    }
    const list = actor.type === 'agent' ? agents.data?.data : people.data;
    return list?.find((item) => item.id === actor.id)?.name ?? '…';
  };
}
