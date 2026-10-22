import { ItemRepository } from '../../data';
import { WebhookClient } from '../../integrations';
import { ItemLogger } from '../../observability';
import { Item } from '../../shared/types';
import { ItemService } from './item.service';

function mockRepository(): jest.Mocked<ItemRepository> {
  return {
    create: jest.fn(),
    list: jest.fn(),
    count: jest.fn(),
    getById: jest.fn(),
    getByName: jest.fn()
  };
}

function mockWebhookClient(): jest.Mocked<WebhookClient> {
  return {
    send: jest.fn().mockResolvedValue(undefined)
  };
}

function mockLogger(): jest.Mocked<ItemLogger> {
  return {
    onItemCreated: jest.fn(),
    onItemListed: jest.fn(),
    onItemFetched: jest.fn(),
    onItemWebhookFailed: jest.fn()
  } as unknown as jest.Mocked<ItemLogger>;
}

const widget: Item = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Widget',
  description: null,
  metadata: {},
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
};

describe('ItemService', () => {
  it('creates items with defaults', async () => {
    const repository = mockRepository();
    const logger = mockLogger();
    repository.getByName.mockResolvedValue(null);
    repository.create.mockResolvedValue(widget);
    const service = new ItemService(repository, mockWebhookClient(), logger);

    const item = await service.createItem({ name: 'Widget' });

    expect(item).toBe(widget);
    expect(repository.create).toHaveBeenCalledWith({
      name: 'Widget',
      description: null,
      metadata: {}
    });
    expect(logger.onItemCreated).toHaveBeenCalledTimes(1);
  });

  it('sends an item.created webhook', async () => {
    const repository = mockRepository();
    const webhookClient = mockWebhookClient();
    repository.getByName.mockResolvedValue(null);
    repository.create.mockResolvedValue(widget);
    const service = new ItemService(repository, webhookClient, mockLogger());

    await service.createItem({ name: 'Widget' });

    expect(webhookClient.send).toHaveBeenCalledWith({ event: 'item.created', data: widget });
  });

  it('still returns the item when the webhook fails', async () => {
    const repository = mockRepository();
    const webhookClient = mockWebhookClient();
    const logger = mockLogger();
    const failure = new Error('Webhook returned status 500');
    repository.getByName.mockResolvedValue(null);
    repository.create.mockResolvedValue(widget);
    webhookClient.send.mockRejectedValue(failure);
    const service = new ItemService(repository, webhookClient, logger);

    await expect(service.createItem({ name: 'Widget' })).resolves.toBe(widget);
    expect(logger.onItemWebhookFailed).toHaveBeenCalledWith(failure);
  });

  it('rejects an item name that is already taken', async () => {
    const repository = mockRepository();
    const logger = mockLogger();
    repository.getByName.mockResolvedValue(widget);
    const service = new ItemService(repository, mockWebhookClient(), logger);

    await expect(service.createItem({ name: 'WIDGET' })).rejects.toMatchObject({
      name: 'itemNameTaken',
      code: 20001,
      statusCode: 409
    });
    expect(repository.getByName).toHaveBeenCalledWith('WIDGET');
    expect(repository.create).not.toHaveBeenCalled();
    expect(logger.onItemCreated).not.toHaveBeenCalled();
  });

  it('lists items with limit and offset', async () => {
    const repository = mockRepository();
    const logger = mockLogger();
    repository.list.mockResolvedValue([widget]);
    repository.count.mockResolvedValue(3);
    const service = new ItemService(repository, mockWebhookClient(), logger);

    const result = await service.listItems({ limit: 2, offset: 1 });

    expect(result).toEqual({ items: [widget], total: 3 });
    expect(repository.list).toHaveBeenCalledWith({ limit: 2, offset: 1 });
  });

  it('returns an item by id', async () => {
    const repository = mockRepository();
    const logger = mockLogger();
    repository.getById.mockResolvedValue(widget);
    const service = new ItemService(repository, mockWebhookClient(), logger);

    await expect(service.getItem(widget.id)).resolves.toBe(widget);
  });

  it('throws not found for missing items', async () => {
    const repository = mockRepository();
    const logger = mockLogger();
    repository.getById.mockResolvedValue(null);
    const service = new ItemService(repository, mockWebhookClient(), logger);

    await expect(service.getItem(widget.id)).rejects.toMatchObject({
      name: 'itemNotFound',
      code: 20002,
      statusCode: 404
    });
  });
});
