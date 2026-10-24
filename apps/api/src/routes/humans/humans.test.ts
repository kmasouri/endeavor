import { setupApp } from '../../app';

const ACTOR = '00000000-0000-4000-8000-000000000001';

describe('personal profile API', () => {
  it.each([
    {},
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(101) },
    { name: 'Name', role: 'admin' },
    { id: ACTOR, name: 'Name' },
    { preferences: {} },
    { preferences: { theme: 'blue' } },
    { preferences: { timeFormat: 'iso' } },
    { preferences: { theme: 'dark', extra: true } },
    { preferences: null }
  ])('rejects invalid or unknown fields: %j', async (payload) => {
    const app = setupApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/humans/me',
      headers: { 'x-actor-id': ACTOR },
      payload
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.name).toBe('validationError');
    await app.close();
  });

  it('requires an acting person', async () => {
    const app = setupApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/humans/me',
      payload: { name: 'Name' }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it.each([
    { name: '  Kayvan  ' },
    { preferences: { theme: 'system', timeFormat: '24h' } },
    { preferences: { timeFormat: '12h' } }
  ])('updates the selected person: %j', async (payload) => {
    const app = setupApp();
    await app.ready();
    const human = {
      id: ACTOR,
      name: 'Kayvan',
      role: 'member' as const,
      createdAt: new Date(),
      preferences: { theme: 'system' as const, timeFormat: '12h' as const }
    };
    const update = jest.spyOn(app.humanService, 'updateProfile').mockResolvedValue(human);
    const response = await app.inject({
      method: 'PATCH',
      url: '/humans/me',
      headers: { 'x-actor-id': ACTOR },
      payload
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: ACTOR,
      name: 'Kayvan',
      preferences: human.preferences
    });
    expect(update).toHaveBeenCalledWith(ACTOR, 'name' in payload ? { name: 'Kayvan' } : payload);
    await app.close();
  });
});
