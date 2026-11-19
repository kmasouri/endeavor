import { loadAll } from './pages/agent-data';
import { getActorId, type Conversation } from './api';

// Fetch every accessible page so restoration and search also find older endeavors.
export async function loadEndeavors(state: 'open' | 'all' = 'open'): Promise<Conversation[]> {
  if (!getActorId()) return [];
  const conversations = await loadAll<Conversation>(`/conversations?state=${state}`);
  return [
    ...new Map(conversations.map((conversation) => [conversation.id, conversation])).values()
  ];
}

export function readLastEndeavor(actorId: string): string | null {
  try {
    return localStorage.getItem(`endeavor.lastConversation.${actorId}`);
  } catch {
    return null;
  }
}
export function rememberEndeavor(actorId: string, id: string): void {
  try {
    localStorage.setItem(`endeavor.lastConversation.${actorId}`, id);
  } catch {
    /* Navigation still works when browser storage is unavailable. */
  }
}
