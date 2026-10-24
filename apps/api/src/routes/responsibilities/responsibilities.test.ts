import { setupApp } from '../../app';

const ACTOR = '00000000-0000-4000-8000-000000000001';
const body = { agentId: ACTOR, title: 'Check', brief: 'Check API', completionCriteria: 'Report' };
const recurrence = {
  frequency: 'weekly',
  days: [1, 3, 5],
  time: '09:00',
  timeZone: 'America/New_York'
};

describe('schedule API validation', () => {
  it.each([
    {},
    { intervalMinutes: 4 },
    { intervalMinutes: 5.5 },
    { intervalMinutes: 60, recurrence },
    { recurrence, startAt: '2026-10-24T00:00:00Z' },
    { recurrence: { ...recurrence, days: [] } },
    { recurrence: { ...recurrence, days: [1, 1] } },
    { recurrence: { ...recurrence, days: [0, 8] } },
    { recurrence: { ...recurrence, time: '24:00' } },
    { recurrence: { ...recurrence, timeZone: 'Made/Up' } },
    { recurrence: { ...recurrence, timeZone: '+05:00' } },
    { recurrence: { ...recurrence, frequency: 'daily' } },
    { recurrence: { ...recurrence, extra: true } },
    { intervalMinutes: 60, extra: true }
  ])('rejects an invalid creation: %j', async (schedule) => {
    const app = setupApp();
    const response = await app.inject({
      method: 'POST',
      url: '/responsibilities',
      headers: { 'x-actor-id': ACTOR },
      payload: { ...body, ...schedule }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.name).toBe('validationError');
    await app.close();
  });
  it.each([{ recurrence }, { intervalMinutes: 60 }])(
    'accepts calendar and legacy interval requests: %j',
    async (schedule) => {
      const app = setupApp();
      await app.ready();
      const create = jest
        .spyOn(app.responsibilityService, 'create')
        .mockResolvedValue({ ...body, ...schedule } as never);
      const response = await app.inject({
        method: 'POST',
        url: '/responsibilities',
        headers: { 'x-actor-id': ACTOR },
        payload: { ...body, ...schedule }
      });
      expect(response.statusCode).toBe(201);
      expect(create).toHaveBeenCalledWith(ACTOR, { ...body, ...schedule });
      await app.close();
    }
  );
  it.each([
    {},
    { recurrence, intervalMinutes: 60 },
    { recurrence, nextRunAt: '2026-10-24T00:00:00Z' }
  ])('rejects an invalid update: %j', async (payload) => {
    const app = setupApp();
    const response = await app.inject({
      method: 'PATCH',
      url: `/responsibilities/${ACTOR}`,
      headers: { 'x-actor-id': ACTOR },
      payload
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
