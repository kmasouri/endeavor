import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Human, HumanRole, HumanPreferences } from '../../shared/types';
import { CreateHumanInput, HumanRepository, UpdateHumanInput } from './human.repository';

interface HumanRow {
  id: string;
  name: string;
  role: HumanRole;
  theme: HumanPreferences['theme'];
  time_format: HumanPreferences['timeFormat'];
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

  async createFirst(input: CreateHumanInput): Promise<Human | null> {
    const result = await this.db.query<HumanRow>(
      `INSERT INTO bold_cedar_007.humans (id, name, role, is_first)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (is_first) WHERE is_first DO NOTHING
       RETURNING *`,
      [randomUUID(), input.name, input.role]
    );

    return result.rows[0] ? this.toHuman(result.rows[0]) : null;
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

  async update(humanId: string, input: UpdateHumanInput): Promise<Human | null> {
    const result = await this.db.query<HumanRow>(
      `UPDATE bold_cedar_007.humans
       SET name = COALESCE($2, name), theme = COALESCE($3, theme),
           time_format = COALESCE($4, time_format)
       WHERE id = $1 RETURNING *`,
      [
        humanId,
        input.name ?? null,
        input.preferences?.theme ?? null,
        input.preferences?.timeFormat ?? null
      ]
    );
    return result.rows[0] ? this.toHuman(result.rows[0]) : null;
  }

  async count(): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM bold_cedar_007.humans`
    );

    return result.rows[0].total;
  }

  private toHuman(row: HumanRow): Human {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      preferences: { theme: row.theme, timeFormat: row.time_format },
      createdAt: row.created_at
    };
  }
}
