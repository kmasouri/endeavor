import { ConnectionHttpClient, joinUrl } from './connection-http.client';

describe('ConnectionHttpClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the request with the given headers and truncates long bodies', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('x'.repeat(50), { status: 200 }));
    const client = new ConnectionHttpClient({ timeoutMs: 1000, maxResponseChars: 10 });

    const response = await client.request({
      baseUrl: 'https://api.example.test/v2/',
      method: 'POST',
      path: '/items?limit=1',
      headers: { authorization: 'Bearer t' },
      body: '{"a":1}'
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/v2/items?limit=1');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' }
    });
    expect(response).toEqual({ status: 200, body: 'x'.repeat(10), truncated: true });
  });
});

describe('joinUrl', () => {
  it('keeps paths on the connection host', () => {
    expect(joinUrl('https://a.test/base', '/x')).toBe('https://a.test/base/x');
    expect(() => joinUrl('https://a.test', '//evil.test/x')).toThrow('host');
  });
});
