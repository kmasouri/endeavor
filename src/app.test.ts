import { setupApp } from './app';

describe('app routes', () => {
  it('returns the healthcheck response', async () => {
    const app = setupApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        status: 'ok'
      }
    });
    await app.close();
  });

  it('serves Swagger UI', async () => {
    const app = setupApp();

    const response = await app.inject({
      method: 'GET',
      url: '/docs'
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    await app.close();
  });

  it('converts Zod route schemas into the OpenAPI document', async () => {
    const app = setupApp();

    const response = await app.inject({
      method: 'GET',
      url: '/docs/json'
    });

    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(
      document.paths['/items'].post.requestBody.content['application/json'].schema
    ).toMatchObject({
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1 }
      }
    });
    await app.close();
  });

  it('returns lists with paging info', async () => {
    const app = setupApp();
    await app.ready();
    jest.spyOn(app.itemService, 'listItems').mockResolvedValue({ items: [], total: 3 });

    const response = await app.inject({ method: 'GET', url: '/items?limit=2&offset=1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [],
      page: { limit: 2, offset: 1, total: 3 }
    });
    await app.close();
  });

  it('uses an incoming request id header when provided', async () => {
    const app = setupApp();
    const requestId = 'external-trace-id-123';

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': requestId
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe(requestId);
    await app.close();
  });

  it('generates a UUID request id when none is provided', async () => {
    const app = setupApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    await app.close();
  });

  it.each([
    [
      'an invalid path param',
      { method: 'GET' as const, url: '/items/not-a-uuid' },
      [{ field: 'itemId', in: 'params', message: 'Invalid UUID' }]
    ],
    [
      'an out-of-range query param',
      { method: 'GET' as const, url: '/items?limit=500' },
      [{ field: 'limit', in: 'querystring', message: 'Too big: expected number to be <=100' }]
    ],
    [
      'a body with a missing required field',
      { method: 'POST' as const, url: '/items', payload: { description: 'no name' } },
      [
        {
          field: 'name',
          in: 'body',
          message: 'Invalid input: expected string, received undefined'
        }
      ]
    ],
    [
      'a body with unknown fields',
      {
        method: 'POST' as const,
        url: '/items',
        payload: { name: 'Widget', extra: true, other: 1 }
      },
      [
        { field: 'extra', in: 'body', message: 'Unknown field' },
        { field: 'other', in: 'body', message: 'Unknown field' }
      ]
    ]
  ])('returns validation errors with the bad fields for %s', async (_, request, details) => {
    const app = setupApp();

    const response = await app.inject(request);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 10001,
        name: 'validationError',
        message: 'Request validation failed',
        requestId: expect.any(String),
        details
      }
    });
    await app.close();
  });

  it('returns 400 in the error format for a body that is not valid JSON', async () => {
    const app = setupApp();

    const response = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { 'content-type': 'application/json' },
      payload: '{not json'
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 10003, name: 'invalidRequest' }
    });
    await app.close();
  });

  it('returns 415 in the error format for an unsupported content type', async () => {
    const app = setupApp();

    const response = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { 'content-type': 'text/xml' },
      payload: '<item />'
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({
      error: { code: 10005, name: 'unsupportedMediaType' }
    });
    await app.close();
  });

  it('returns 413 in the error format for a body that is too large', async () => {
    const app = setupApp();

    const response = await app.inject({
      method: 'POST',
      url: '/items',
      payload: { name: 'x'.repeat(2 * 1024 * 1024) }
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: { code: 10004, name: 'payloadTooLarge' }
    });
    await app.close();
  });

  it('returns 404 in the error format for an unknown route', async () => {
    const app = setupApp();

    const response = await app.inject({
      method: 'GET',
      url: '/does-not-exist'
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 10002,
        name: 'routeNotFound',
        message: 'Route GET /does-not-exist not found',
        requestId: expect.any(String)
      }
    });
    await app.close();
  });

  it('hides the details of unexpected errors and logs them with the request id', async () => {
    const app = setupApp();
    app.get('/boom', async () => {
      throw new Error('secret database detail');
    });
    const logs: unknown[] = [];
    app.addHook('onRequest', async (request) => {
      jest.spyOn(request.log, 'error').mockImplementation((...args: unknown[]) => {
        logs.push({ reqId: request.id, args });
      });
    });

    const response = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { 'x-request-id': 'trace-500' }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 10000,
        name: 'internalError',
        message: 'Unexpected server error',
        requestId: 'trace-500'
      }
    });
    expect(logs).toEqual([{ reqId: 'trace-500', args: [expect.any(Error)] }]);
    await app.close();
  });
});
