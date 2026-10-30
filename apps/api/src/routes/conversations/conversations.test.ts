import { setupApp } from '../../app';

const ACTOR = '00000000-0000-4000-8000-000000000001';
const PERSON = '00000000-0000-4000-8000-000000000002';

describe('conversation creation', () => {
  it.each([
    { title: 'Goal', humanIds: ['invalid'] },
    { title: 'Goal', humanIds: Array(21).fill(PERSON) },
    { title: 'Goal', humanIds: [PERSON], unknown: true }
  ])('rejects invalid initial membership: %j', async (payload) => {
    const app = setupApp();
    const response = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { 'x-actor-id': ACTOR },
      payload
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.name).toBe('validationError');
    await app.close();
  });

  it('passes a canonical name and chosen members to the service', async () => {
    const app = setupApp();
    await app.ready();
    const create = jest.spyOn(app.conversationService, 'createConversation').mockResolvedValue({
      id: 'created',
      title: 'Goal',
      createdByHumanId: ACTOR,
      budgetUsd: null,
      createdAt: new Date(),
      members: []
    });
    const response = await app.inject({
      method: 'POST',
      url: '/conversations',
      headers: { 'x-actor-id': ACTOR },
      payload: { title: '  Goal  ', humanIds: [PERSON], agentIds: [] }
    });
    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(ACTOR, { title: 'goal', humanIds: [PERSON], agentIds: [] });
    await app.close();
  });
  it.each(['', '   ', '#!?', '---', '🧪', 'a'.repeat(65), 'a'.repeat(201)])(
    'rejects an empty or oversized canonical name: %s',
    async (title) => {
      const app = setupApp();
      await app.ready();
      const create = jest.spyOn(app.conversationService, 'createConversation');
      const response = await app.inject({
        method: 'POST',
        url: '/conversations',
        headers: { 'x-actor-id': ACTOR },
        payload: { title }
      });
      expect(response.statusCode).toBe(400);
      expect(create).not.toHaveBeenCalled();
      await app.close();
    }
  );

  it.each(['POST', 'PATCH'] as const)(
    'enforces the 64-character boundary on %s',
    async (method) => {
      const app = setupApp();
      await app.ready();
      const create = jest
        .spyOn(app.conversationService, 'createConversation')
        .mockResolvedValue({ title: 'a'.repeat(64) } as never);
      const update = jest
        .spyOn(app.conversationService, 'updateConversation')
        .mockResolvedValue({ title: 'a'.repeat(64) } as never);
      for (const length of [64, 65]) {
        const response = await app.inject({
          method,
          url: method === 'POST' ? '/conversations' : `/conversations/${ACTOR}`,
          headers: { 'x-actor-id': ACTOR },
          payload: { title: 'a'.repeat(length) }
        });
        expect(response.statusCode).toBe(length === 65 ? 400 : method === 'POST' ? 201 : 200);
      }
      expect(create.mock.calls.length + update.mock.calls.length).toBe(1);
      await app.close();
    }
  );

  it.each(['  Heat Pumps!! Brief  ', '#HEAT___PUMPS / BRIEF', 'heat--pumps-brief---'])(
    'normalizes direct API creates and renames: %s',
    async (title) => {
      const app = setupApp();
      await app.ready();
      const saved = {
        id: ACTOR,
        title: 'heat-pumps-brief',
        createdByHumanId: ACTOR,
        budgetUsd: null,
        createdAt: new Date(),
        members: []
      };
      const create = jest
        .spyOn(app.conversationService, 'createConversation')
        .mockResolvedValue(saved);
      const update = jest
        .spyOn(app.conversationService, 'updateConversation')
        .mockResolvedValue(saved);
      for (const method of ['POST', 'PATCH'] as const) {
        const response = await app.inject({
          method,
          url: method === 'POST' ? '/conversations' : `/conversations/${ACTOR}`,
          headers: { 'x-actor-id': ACTOR },
          payload: { title }
        });
        expect(response.statusCode).toBe(method === 'POST' ? 201 : 200);
        expect(response.json().data.title).toBe('heat-pumps-brief');
      }
      expect(create).toHaveBeenCalledWith(ACTOR, { title: 'heat-pumps-brief' });
      expect(update).toHaveBeenCalledWith(ACTOR, ACTOR, { title: 'heat-pumps-brief' });
      await app.close();
    }
  );

  it('rejects a rename with no remaining letters or numbers', async () => {
    const app = setupApp();
    const response = await app.inject({
      method: 'PATCH',
      url: `/conversations/${ACTOR}`,
      headers: { 'x-actor-id': ACTOR },
      payload: { title: '! # ---' }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('marking a conversation read', () => {
  const CONVERSATION = '00000000-0000-4000-8000-0000000000f1';
  const MESSAGE = '00000000-0000-4000-8000-0000000000e1';

  it.each([{}, { messageId: 'not-a-uuid' }, { messageId: MESSAGE, extra: true }])(
    'rejects an invalid body: %j',
    async (payload) => {
      const app = setupApp();
      await app.ready();
      const markRead = jest.spyOn(app.conversationService, 'markRead');
      const response = await app.inject({
        method: 'PUT',
        url: `/conversations/${CONVERSATION}/read`,
        headers: { 'x-actor-id': ACTOR },
        payload
      });
      expect(response.statusCode).toBe(400);
      expect(markRead).not.toHaveBeenCalled();
      await app.close();
    }
  );

  it('passes the message to the service and returns the unread count', async () => {
    const app = setupApp();
    await app.ready();
    const markRead = jest
      .spyOn(app.conversationService, 'markRead')
      .mockResolvedValue({ conversationId: CONVERSATION, unreadCount: 0 });
    const response = await app.inject({
      method: 'PUT',
      url: `/conversations/${CONVERSATION}/read`,
      headers: { 'x-actor-id': ACTOR },
      payload: { messageId: MESSAGE }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ conversationId: CONVERSATION, unreadCount: 0 });
    expect(markRead).toHaveBeenCalledWith(ACTOR, CONVERSATION, { messageId: MESSAGE });
    await app.close();
  });
});

describe('listing conversations', () => {
  it('returns each conversation with its unread count', async () => {
    const app = setupApp();
    await app.ready();
    jest.spyOn(app.conversationService, 'listConversations').mockResolvedValue({
      conversations: [
        {
          id: PERSON,
          title: 'website-check',
          createdByHumanId: ACTOR,
          budgetUsd: null,
          createdAt: new Date(),
          unreadCount: 3
        }
      ],
      total: 1
    });
    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { 'x-actor-id': ACTOR }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].unreadCount).toBe(3);
    await app.close();
  });
});

describe('message window queries', () => {
  const CONVERSATION = '00000000-0000-4000-8000-000000000003';
  it.each([
    'latest=true&beforeId=' + PERSON,
    'beforeId=' + PERSON + '&afterId=' + ACTOR,
    'latest=true&offset=1',
    'latest=wrong',
    'afterId=invalid'
  ])('rejects invalid window %s', async (query) => {
    const app = setupApp();
    const response = await app.inject({
      method: 'GET',
      url: `/conversations/${CONVERSATION}/messages?${query}`,
      headers: { 'x-actor-id': ACTOR }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
  it.each(['latest=true', 'beforeId=' + PERSON, 'afterId=' + PERSON])(
    'passes the window query %s without changing its array response',
    async (query) => {
      const app = setupApp();
      await app.ready();
      const list = jest.spyOn(app.conversationService, 'listMessages').mockResolvedValue([]);
      const response = await app.inject({
        method: 'GET',
        url: `/conversations/${CONVERSATION}/messages?limit=50&${query}`,
        headers: { 'x-actor-id': ACTOR }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [] });
      expect(list).toHaveBeenCalledWith(
        ACTOR,
        CONVERSATION,
        expect.objectContaining({ limit: 50, offset: 0 })
      );
      await app.close();
    }
  );
});
