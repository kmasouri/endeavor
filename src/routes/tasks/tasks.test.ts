import { setupApp } from '../../app';

const ACTOR = '00000000-0000-4000-8000-000000000001';
const TASK = '00000000-0000-4000-8000-0000000000c1';

describe('task routes', () => {
  it('requires x-actor-id for human actions', async () => {
    const app = setupApp();

    const response = await app.inject({ method: 'POST', url: `/tasks/${TASK}/pause`, payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details).toEqual([
      expect.objectContaining({ field: 'x-actor-id', in: 'headers' })
    ]);
    await app.close();
  });

  it('passes the actor, task, and reason to the service', async () => {
    const app = setupApp();
    await app.ready();
    const pause = jest.spyOn(app.taskService, 'pauseTask').mockResolvedValue({ id: TASK } as never);

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${TASK}/pause`,
      headers: { 'x-actor-id': ACTOR },
      payload: { reason: 'Hold on' }
    });

    expect(response.statusCode).toBe(200);
    expect(pause).toHaveBeenCalledWith(ACTOR, TASK, 'Hold on');
    await app.close();
  });

  it('returns 201 for a new task and 200 for a repeated runKey', async () => {
    const app = setupApp();
    await app.ready();
    const create = jest.spyOn(app.taskService, 'createTask');
    const payload = {
      ownerAgentId: '00000000-0000-4000-8000-0000000000a1',
      title: 'Summarize',
      brief: 'Read the docs',
      completionCriteria: 'A summary',
      runKey: 'abc'
    };

    create.mockResolvedValueOnce({ task: { id: TASK } as never, created: true });
    const first = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { 'x-actor-id': ACTOR },
      payload
    });
    create.mockResolvedValueOnce({ task: { id: TASK } as never, created: false });
    const second = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { 'x-actor-id': ACTOR },
      payload
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    await app.close();
  });

  it('rejects an unknown task state filter', async () => {
    const app = setupApp();

    const response = await app.inject({ method: 'GET', url: '/tasks?state=paused' });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
