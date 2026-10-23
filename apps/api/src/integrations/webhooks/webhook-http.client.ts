import { WebhookClient, WebhookEvent } from './webhook.client';

const DEFAULT_TIMEOUT_MS = 3000;

// Sends each event as a JSON POST to one URL. With no URL, webhooks are off and send() does
// nothing. Throws if the call fails or times out; the service decides what to do about it.
export class WebhookHttpClient implements WebhookClient {
  constructor(
    private readonly url: string | undefined,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  async send(event: WebhookEvent): Promise<void> {
    if (!this.url) {
      return;
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Webhook returned status ${response.status}`);
    }
  }
}
