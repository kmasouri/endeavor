import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Item } from '../../shared/types';
import { CreateItemInput, ItemRepository, ListItemsInput } from './item.repository';

interface ItemRow {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export class ItemPostgresRepository implements ItemRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(input: CreateItemInput): Promise<Item> {
    const result = await this.db.query<ItemRow>(
      `INSERT INTO bold_cedar_007.items (id, name, description, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [randomUUID(), input.name, input.description, input.metadata]
    );

    return this.toItem(result.rows[0]);
  }

  async list(input: ListItemsInput): Promise<Item[]> {
    const result = await this.db.query<ItemRow>(
      `SELECT *
       FROM bold_cedar_007.items
       ORDER BY name
       LIMIT $1 OFFSET $2`,
      [input.limit, input.offset]
    );

    return result.rows.map((row) => this.toItem(row));
  }

  async count(): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM bold_cedar_007.items`
    );

    return result.rows[0].total;
  }

  async getById(itemId: string): Promise<Item | null> {
    const result = await this.db.query<ItemRow>(
      `SELECT *
       FROM bold_cedar_007.items
       WHERE id = $1`,
      [itemId]
    );

    return result.rows[0] ? this.toItem(result.rows[0]) : null;
  }

  async getByName(name: string): Promise<Item | null> {
    const result = await this.db.query<ItemRow>(
      `SELECT *
       FROM bold_cedar_007.items
       WHERE lower(name) = lower($1)`,
      [name]
    );

    return result.rows[0] ? this.toItem(result.rows[0]) : null;
  }

  private toItem(row: ItemRow): Item {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
