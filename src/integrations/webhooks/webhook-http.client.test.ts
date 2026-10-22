import { WebhookHttpClient } from './webhook-http.client';

describe('WebhookHttpClient', () => {
  const fetchMock = jest.spyOn(global, 'fetch');

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('does nothing when no URL is set', async () => {
    const client = new WebhookHttpClient(undefined);

    await client.send({ event: 'item.created', data: { id: '1' } });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the event as JSON', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const client = new WebhookHttpClient('https://example.com/hooks');

    await client.send({ event: 'item.created', data: { id: '1' } });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/hooks',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'item.created', data: { id: '1' } })
      })
    );
  });

  it('throws when the webhook answers with an error status', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const client = new WebhookHttpClient('https://example.com/hooks');

    await expect(client.send({ event: 'item.created', data: {} })).rejects.toThrow(/500/);
  });
});
