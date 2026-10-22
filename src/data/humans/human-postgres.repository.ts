import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Human, HumanRole } from '../../shared/types';
import { CreateHumanInput, HumanRepository } from './human.repository';

interface HumanRow {
  id: string;
  name: string;
  role: HumanRole;
  created_at: Date;
}

export class HumanPostgresRepository implements HumanRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(input: CreateHumanInput): Promise<Human> {
    const result = await this.db.query<HumanRow>(
      `INSERT INTO bold_cedar_007.humans (id, name, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [randomUUID(), input.name, input.role]
    );

    return this.toHuman(result.rows[0]);
  }

  async getById(humanId: string): Promise<Human | null> {
    const result = await this.db.query<HumanRow>(
      `SELECT *
       FROM bold_cedar_007.humans
       WHERE id = $1`,
      [humanId]
    );

    return result.rows[0] ? this.toHuman(result.rows[0]) : null;
  }

  async list(): Promise<Human[]> {
    const result = await this.db.query<HumanRow>(
      `SELECT *
       FROM bold_cedar_007.humans
       ORDER BY created_at`
    );

    return result.rows.map((row) => this.toHuman(row));
  }

  async count(): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM bold_cedar_007.humans`
    );

    return result.rows[0].total;
  }

  private toHuman(row: HumanRow): Human {
    return { id: row.id, name: row.name, role: row.role, createdAt: row.created_at };
  }
}
