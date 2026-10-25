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
  it.each(['', '   ', '#!?', '---', '🧪', 'a'.repeat(201)])(
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
