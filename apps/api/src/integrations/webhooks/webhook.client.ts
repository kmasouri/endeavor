export interface WebhookEvent {
  event: string;
  data: unknown;
}

export interface WebhookClient {
  send(event: WebhookEvent): Promise<void>;
}
