import { setupApp } from '../../app';

const ACTOR = '00000000-0000-4000-8000-000000000001';
const PROJECT = '00000000-0000-4000-8000-0000000000e1';

const details = {
  id: PROJECT,
  name: 'Billing',
  about: null,
  isDefault: false,
  createdByHumanId: ACTOR,
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null,
  members: []
};

describe('projects routes', () => {
  it.each([
    {},
    { name: '' },
    { name: 'a'.repeat(101) },
    { name: 'Billing', unknown: true },
    { name: 'Billing', about: 5 },
    { name: 'Billing', about: 'a'.repeat(5001) }
  ])('rejects an invalid create: %j', async (payload) => {
    const app = setupApp();
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { 'x-actor-id': ACTOR },
      payload
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.name).toBe('validationError');
    await app.close();
  });

  it('creates a project and returns 201', async () => {
    const app = setupApp();
    await app.ready();
    const create = jest.spyOn(app.projectService, 'createProject').mockResolvedValue(details);

    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { 'x-actor-id': ACTOR },
      payload: { name: '  Billing  ' }
    });

    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(ACTOR, { name: 'Billing' });
    await app.close();
  });

  it.each([null, '', 'a'.repeat(5000), '  Team background\nSecond line  '])(
    'accepts optional About text on create: %p',
    async (about) => {
      const app = setupApp();
      await app.ready();
      const create = jest.spyOn(app.projectService, 'createProject').mockResolvedValue(details);
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: { 'x-actor-id': ACTOR },
        payload: { name: 'Billing', about }
      });
      expect(response.statusCode).toBe(201);
      expect(create).toHaveBeenCalledWith(ACTOR, {
        name: 'Billing',
        about: typeof about === 'string' ? about.trim() : null
      });
      expect(response.json().data).toHaveProperty('about', null);
      await app.close();
    }
  );

  it.each(['Updated background', null, ''])(
    'sets or clears About through PATCH: %p',
    async (about) => {
      const app = setupApp();
      await app.ready();
      const update = jest.spyOn(app.projectService, 'updateProject').mockResolvedValue(details);
      const response = await app.inject({
        method: 'PATCH',
        url: `/projects/${PROJECT}`,
        headers: { 'x-actor-id': ACTOR },
        payload: { about }
      });
      expect(response.statusCode).toBe(200);
      expect(update).toHaveBeenCalledWith(ACTOR, PROJECT, { about });
      await app.close();
    }
  );

  it.each([5, 'a'.repeat(5001)])('rejects invalid About updates: %p', async (about) => {
    const app = setupApp();
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${PROJECT}`,
      headers: { 'x-actor-id': ACTOR },
      payload: { about }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('lists active projects unless archived=true', async () => {
    const app = setupApp();
    await app.ready();
    const list = jest
      .spyOn(app.projectService, 'listProjects')
      .mockResolvedValue({ projects: [details], total: 1 });

    const response = await app.inject({
      method: 'GET',
      url: '/projects?archived=true&limit=5',
      headers: { 'x-actor-id': ACTOR }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().page).toMatchObject({ limit: 5, offset: 0, total: 1 });
    expect(list).toHaveBeenCalledWith(ACTOR, { archived: true, limit: 5, offset: 0 });
    await app.close();
  });

  it('archives through PATCH and rejects an empty change', async () => {
    const app = setupApp();
    await app.ready();
    const update = jest.spyOn(app.projectService, 'updateProject').mockResolvedValue(details);

    const empty = await app.inject({
      method: 'PATCH',
      url: `/projects/${PROJECT}`,
      headers: { 'x-actor-id': ACTOR },
      payload: {}
    });
    expect(empty.statusCode).toBe(400);

    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${PROJECT}`,
      headers: { 'x-actor-id': ACTOR },
      payload: { archived: true }
    });
    expect(response.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(ACTOR, PROJECT, { archived: true });
    await app.close();
  });
});
