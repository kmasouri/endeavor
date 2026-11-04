import { setupApp } from '../../app';
const h = '00000000-0000-4000-8000-000000000001';
const c = '00000000-0000-4000-8000-000000000002';
const d = '00000000-0000-4000-8000-000000000003';
describe('routing API', () => {
  it('lists decisions through the service', async () => {
    const app = setupApp();
    await app.ready();
    const list = jest
      .spyOn(app.routingService, 'list')
      .mockResolvedValue({ decisions: [], total: 0 });
    const response = await app.inject({
      url: `/conversations/${c}/routing`,
      headers: { 'x-actor-id': h }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [], page: { limit: 50, offset: 0, total: 0 } });
    expect(list).toHaveBeenCalledWith(h, c, { limit: 50, offset: 0 });
    await app.close();
  });
  it.each([
    { agentId: null, revision: -1 },
    { agentId: 'bad', revision: 0 },
    { agentId: null, revision: 0, unknown: true },
    { agentId: null }
  ])('rejects invalid choices %j', async (payload) => {
    const app = setupApp();
    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${c}/routing/${d}/choice`,
      headers: { 'x-actor-id': h },
      payload
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
