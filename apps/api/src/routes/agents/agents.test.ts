import { setupApp } from '../../app';
const agentId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';

it('requires a human header for deletion and returns the service response', async () => {
  const app = setupApp();
  await app.ready();
  const deletion = jest.spyOn(app.agentService, 'deleteAgent').mockResolvedValue({ deleted: true });
  const missing = await app.inject({ method: 'DELETE', url: `/agents/${agentId}` });
  expect(missing.statusCode).toBe(400);
  expect(deletion).not.toHaveBeenCalled();
  const response = await app.inject({
    method: 'DELETE',
    url: `/agents/${agentId}`,
    headers: { 'x-actor-id': actorId }
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ data: { deleted: true } });
  expect(deletion).toHaveBeenCalledWith(actorId, agentId);
  await app.close();
});

it('accepts independent appearance overrides and resets, and rejects unsupported values', async () => {
  const app = setupApp();
  await app.ready();
  const update = jest.spyOn(app.agentService, 'updateProfile').mockResolvedValue({
    id: agentId,
    avatarColor: 'teal',
    avatarIcon: 'file'
  } as Awaited<ReturnType<typeof app.agentService.updateProfile>>);
  const patch = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}`,
      headers: { 'x-actor-id': actorId },
      payload
    });
  for (const body of [
    { avatarColor: 'teal', avatarIcon: 'file' },
    { avatarColor: null },
    { avatarIcon: null }
  ]) {
    expect((await patch(body)).statusCode).toBe(200);
    expect(update).toHaveBeenLastCalledWith(actorId, agentId, body);
  }
  update.mockClear();
  for (const body of [
    { avatarColor: '#ffffff' },
    { avatarIcon: 'unknown' },
    { avatarColor: 1 },
    { avatarIcon: {} },
    { avatarColor: 'teal', upload: 'image' }
  ]) {
    expect((await patch(body)).statusCode).toBe(400);
  }
  expect(update).not.toHaveBeenCalled();
  await app.close();
});

it('validates public profile fields on create and patch without changing configuration', async () => {
  const app = setupApp();
  await app.ready();
  const update = jest
    .spyOn(app.agentService, 'updateProfile')
    .mockResolvedValue({ id: agentId } as never);
  const create = jest
    .spyOn(app.agentService, 'createAgent')
    .mockResolvedValue({ id: agentId } as never);
  const base = {
    name: 'QA',
    purpose: 'Checks changes',
    instructions: 'Private instructions',
    provider: 'scripted',
    model: 'test'
  };
  for (const method of ['POST', 'PATCH'] as const) {
    const send = (fields: Record<string, unknown>) =>
      app.inject({
        method,
        url: method === 'POST' ? '/agents' : `/agents/${agentId}`,
        headers: { 'x-actor-id': actorId },
        payload: { ...(method === 'POST' ? base : {}), ...fields }
      });
    for (const fields of [
      { produces: '  Test results  ', needs: ' Steps ' },
      { produces: null, needs: '' },
      { needs: 'x'.repeat(500) }
    ]) {
      expect((await send(fields)).statusCode).toBe(method === 'POST' ? 201 : 200);
    }
    for (const fields of [
      { produces: 'x'.repeat(501) },
      { needs: 'x'.repeat(501) },
      { produces: 1 },
      { needs: [] },
      { produces: 'ok', secret: true }
    ]) {
      expect((await send(fields)).statusCode).toBe(400);
    }
  }
  expect(update).toHaveBeenCalledWith(actorId, agentId, {
    produces: 'Test results',
    needs: 'Steps'
  });
  expect(create).toHaveBeenCalledWith(
    actorId,
    expect.objectContaining({ produces: 'Test results', needs: 'Steps' })
  );
  await app.close();
});
