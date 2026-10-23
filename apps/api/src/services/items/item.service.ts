import { ItemRepository } from '../../data';
import { WebhookClient } from '../../integrations';
import { ItemLogger } from '../../observability';
import { AppError } from '../../shared/errors';
import { Item } from '../../shared/types';

export class ItemService {
  constructor(
    private readonly itemRepository: ItemRepository,
    private readonly webhookClient: WebhookClient,
    private readonly itemLogger: ItemLogger
  ) {}

  async createItem(input: {
    name: string;
    description?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<Item> {
    const existing = await this.itemRepository.getByName(input.name);
    if (existing) {
      throw new AppError('itemNameTaken', `Item ${input.name} already exists`);
    }

    const item = await this.itemRepository.create({
      name: input.name,
      description: input.description ?? null,
      metadata: input.metadata ?? {}
    });
    this.itemLogger.onItemCreated();
    await this.sendItemCreatedWebhook(item);
    return item;
  }

  async listItems(input: {
    limit: number;
    offset: number;
  }): Promise<{ items: Item[]; total: number }> {
    const [items, total] = await Promise.all([
      this.itemRepository.list(input),
      this.itemRepository.count()
    ]);
    this.itemLogger.onItemListed();
    return { items, total };
  }

  async getItem(itemId: string): Promise<Item> {
    const item = await this.itemRepository.getById(itemId);
    if (!item) {
      throw new AppError('itemNotFound', `Item ${itemId} was not found`);
    }

    this.itemLogger.onItemFetched();
    return item;
  }

  // The item is already saved, so a failed webhook doesn't fail the request. Log it instead.
  private async sendItemCreatedWebhook(item: Item): Promise<void> {
    try {
      await this.webhookClient.send({ event: 'item.created', data: item });
    } catch (error) {
      this.itemLogger.onItemWebhookFailed(error);
    }
  }
}
