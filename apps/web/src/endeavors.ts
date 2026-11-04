import { api, getActorId, type Conversation } from './api';

// Fetch every accessible page so restoration and search also find older endeavors.
export async function loadEndeavors(state: 'open' | 'all' = 'open'): Promise<Conversation[]> {
  const actorId = getActorId();
  const conversations: Conversation[] = [];
  let offset = 0;
  while (actorId && actorId === getActorId()) {
    const page = await api.list<Conversation>(
      `/conversations?state=${state}&limit=100&offset=${offset}`
    );
    conversations.push(...page.data);
    offset += page.data.length;
    if (!page.data.length || offset >= page.page.total) break;
  }
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
