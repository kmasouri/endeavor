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

  it('passes people and agents to the service with a trimmed name', async () => {
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
    expect(create).toHaveBeenCalledWith(ACTOR, { title: 'Goal', humanIds: [PERSON], agentIds: [] });
    await app.close();
  });
});
