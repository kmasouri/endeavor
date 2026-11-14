import type { Page } from '@playwright/test';
import type { AgentAppearance, Member, Message } from '../src/api';

export const createdAt = '2026-10-27T12:00:00Z';
const researcher = {
  id: 'researcher',
  name: 'Researcher',
  purpose: 'Find evidence',
  produces: 'A sourced brief',
  needs: 'A question and source documents',
  skillNames: ['Research', 'Writing'],
  status: 'busy' as const,
  capabilities: { provider: 'openai', model: 'research-model', skillCount: 2, connectionCount: 1 }
};
const reviewer = {
  id: 'reviewer',
  name: 'Reviewer',
  purpose: 'Check evidence',
  produces: null,
  needs: null,
  skillNames: [],
  status: 'idle' as const,
  avatarColor: null,
  avatarIcon: null
};

// All network traffic is intercepted, including read markers and failed writes. No live API.
export async function fixture(
  page: Page,
  theme = 'dark',
  empty = false,
  appearance: AgentAppearance = {}
) {
  const shownResearcher = { ...researcher, ...appearance };
  const state = {
    profileStatus: 'busy' as 'idle' | 'busy',
    extraMembers: [] as Member[],
    failSend: false,
    loseSendResponse: false,
    failMembers: false,
    failMessages: false,
    failHistory: false,
    failRead: false,
    holdHistory: false,
    releaseHistory: () => {},
    queries: [] as string[],
    reads: [] as string[],
    holdSend: false,
    releaseSend: () => {},
    added: false,
    posts: [] as Record<string, unknown>[],
    memberPosts: [] as Record<string, unknown>[],
    messages: empty
      ? []
      : ([
          {
            id: 'question',
            authorType: 'human',
            authorId: 'person',
            body: 'Which sources should we use?',
            taskId: null,
            mentions: [],
            inReplyToMessageId: null,
            createdAt
          }
        ] as Message[])
  };
  const errors: string[] = [];
  const unexpected: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date(createdAt));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('endeavor.actorId', 'person'));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:5190') return route.abort();
    if (url.pathname.startsWith('/app/')) return route.continue();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data)
      });
    const list = (data: unknown[]) =>
      reply({ data, page: { total: data.length, limit: 100, offset: 0 } });
    const path = url.pathname;
    if (req.method() === 'POST' && path === '/conversations/brief/messages') {
      const body = req.postDataJSON();
      state.posts.push(body);
      if (state.holdSend)
        await new Promise<void>((resolve) => {
          state.releaseSend = resolve;
        });
      if (state.failSend) return reply({ error: { message: 'Message not sent. Try again.' } }, 503);
      const existing = state.messages.find(
        (message) =>
          body.clientKey &&
          (message as Message & { clientKey?: string }).clientKey === body.clientKey
      );
      if (existing) return reply({ data: existing });
      const message: Message = {
        ...body,
        id: `sent-${state.posts.length}`,
        authorType: 'human',
        authorId: 'person',
        taskId: null,
        inReplyToMessageId: body.inReplyToMessageId ?? null,
        createdAt
      };
      state.messages.push(message);
      if (state.loseSendResponse) {
        state.loseSendResponse = false;
        return route.abort('failed');
      }
      return reply({ data: message }, 201);
    }
    if (req.method() === 'POST' && path === '/conversations/brief/members') {
      state.memberPosts.push(req.postDataJSON());
      if (state.failMembers) return reply({ error: { message: 'Could not add Reviewer' } }, 503);
      state.added = true;
      return reply({ data: {} }, 201);
    }
    if (req.method() === 'PUT' && path === '/conversations/brief/read') {
      state.reads.push(req.postDataJSON().messageId);
      if (state.failRead) return reply({ error: { message: 'Read marker unavailable' } }, 503);
      return reply({ data: {} });
    }
    if (req.method() !== 'GET') {
      unexpected.push(`${req.method()} ${path}`);
      return reply({ error: { message: 'Unexpected write' } }, 500);
    }
    if (path === '/humans')
      return reply({ data: [{ id: 'person', name: 'Kayvan', preferences: { theme } }] });
    if (path === '/directory') return list([shownResearcher, reviewer]);
    if (path === '/agents') return list([shownResearcher, reviewer]);
    if (path === '/conversations') return list([{ id: 'brief', title: 'source-brief', createdAt }]);
    if (path === '/conversations/brief')
      return reply({
        data: {
          id: 'brief',
          title: 'source-brief',
          createdAt,
          members: [
            { participant: { type: 'human', id: 'person' }, name: 'Kayvan', historyFrom: null },
            ...state.extraMembers,
            ...[shownResearcher, ...(state.added ? [reviewer] : [])].map((a) => ({
              participant: { type: 'agent', id: a.id },
              name: a.name,
              purpose: a.purpose,
              produces: a.produces,
              needs: a.needs,
              skillNames: a.skillNames,
              status: a.id === 'researcher' ? state.profileStatus : a.status,
              avatarColor: a.avatarColor,
              avatarIcon: a.avatarIcon,
              historyFrom: null
            }))
          ]
        }
      });
    if (path === '/conversations/brief/messages') {
      if (state.failMessages) return reply({ error: { message: 'Messages unavailable' } }, 503);
      state.queries.push(url.search);
      const limit = Number(url.searchParams.get('limit'));
      const before = url.searchParams.get('beforeId');
      const after = url.searchParams.get('afterId');
      if (before && state.failHistory)
        return reply({ error: { message: 'History unavailable' } }, 503);
      if (before && state.holdHistory)
        await new Promise<void>((resolve) => {
          state.releaseHistory = resolve;
        });
      const index = state.messages.findIndex((message) => message.id === (before ?? after));
      const result = before
        ? state.messages.slice(Math.max(0, index - limit), index)
        : after
          ? state.messages.slice(index + 1, index + 1 + limit)
          : state.messages.slice(-limit);
      return reply({ data: result });
    }
    if (path === '/conversations/brief/costs')
      return reply({
        data: {
          total: { costUsd: 0, tokens: 0, unpricedCalls: 0 },
          thisMonth: { costUsd: 0 },
          budgetUsd: null,
          tasks: []
        }
      });
    if (
      [
        '/conversations/brief/routing',
        '/projects',
        '/tasks',
        '/responsibilities',
        '/approvals',
        '/conversations/brief/outputs',
        '/conversations/brief/documents'
      ].includes(path)
    )
      return list([]);
    unexpected.push(`GET ${path}`);
    return reply({ error: { message: 'Unexpected read' } }, 500);
  });
  return { state, errors, unexpected };
}
