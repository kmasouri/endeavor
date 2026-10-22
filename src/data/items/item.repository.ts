import { Item } from '../../shared/types';

export interface CreateItemInput {
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
}

export interface ListItemsInput {
  limit: number;
  offset: number;
}

export interface ItemRepository {
  create(input: CreateItemInput): Promise<Item>;
  list(input: ListItemsInput): Promise<Item[]>;
  count(): Promise<number>;
  getById(itemId: string): Promise<Item | null>;
  getByName(name: string): Promise<Item | null>;
}
