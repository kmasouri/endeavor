import { setupApp } from '../../app';

const ACTOR = '00000000-0000-4000-8000-000000000001';
const SKILL = '00000000-0000-4000-8000-000000000002';
const CONNECTION = '00000000-0000-4000-8000-000000000003';

describe('instructions-only skill routes', () => {
  it.each(['/skills', `/skills/${SKILL}/versions`])(
    'rejects retired connectionIds on %s before calling a service',
    async (url) => {
      const app = setupApp();
      await app.ready();
      const create = jest.spyOn(app.catalogService, 'createSkill');
      const version = jest.spyOn(app.catalogService, 'addSkillVersion');
      try {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: { 'x-actor-id': ACTOR },
          payload: {
            ...(url === '/skills' ? { name: 'Billing', description: 'Invoices' } : {}),
            instructions: 'Read invoices.',
            connectionIds: [CONNECTION]
          }
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.details).toContainEqual(
          expect.objectContaining({ field: 'connectionIds', in: 'body' })
        );
        expect(create).not.toHaveBeenCalled();
        expect(version).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    }
  );

  it('accepts instructions-only creation and new versions', async () => {
    const app = setupApp();
    await app.ready();
    const create = jest
      .spyOn(app.catalogService, 'createSkill')
      .mockResolvedValue({ id: SKILL } as never);
    const version = jest
      .spyOn(app.catalogService, 'addSkillVersion')
      .mockResolvedValue({ id: SKILL } as never);
    try {
      const input = { name: 'Billing', description: 'Invoices', instructions: 'Read invoices.' };
      const created = await app.inject({
        method: 'POST',
        url: '/skills',
        headers: { 'x-actor-id': ACTOR },
        payload: input
      });
      const updated = await app.inject({
        method: 'POST',
        url: `/skills/${SKILL}/versions`,
        headers: { 'x-actor-id': ACTOR },
        payload: { instructions: 'Cite invoices.' }
      });
      expect(created.statusCode).toBe(201);
      expect(updated.statusCode).toBe(201);
      expect(create).toHaveBeenCalledWith(ACTOR, input);
      expect(version).toHaveBeenCalledWith(ACTOR, SKILL, { instructions: 'Cite invoices.' });
    } finally {
      await app.close();
    }
  });
});
