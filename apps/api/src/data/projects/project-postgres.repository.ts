import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { ParticipantRef, Project, ProjectAppearance, ProjectMember } from '../../shared/types';
import { ProjectRepository } from './project.repository';

interface ProjectRow {
  id: string;
  name: string;
  context: { about?: string };
  icon: ProjectAppearance['icon'];
  color: ProjectAppearance['color'];
  is_default: boolean;
  created_by_human_id: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

interface MemberRow {
  project_id: string;
  participant_type: 'human' | 'agent';
  participant_id: string;
  added_by_human_id: string | null;
  added_at: Date;
}

// Projects the person belongs to, or has an endeavor in. $1 is the person, or null for all.
const VISIBLE_TO_HUMAN = `(
  $1::uuid IS NULL
  OR EXISTS (
    SELECT 1
    FROM endeavor.project_members pm
    WHERE pm.project_id = p.id
      AND pm.participant_type = 'human'
      AND pm.participant_id = $1
      AND pm.removed_at IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM endeavor.conversations c
    JOIN endeavor.conversation_members cm ON cm.conversation_id = c.id
    WHERE c.project_id = p.id
      AND cm.participant_type = 'human'
      AND cm.participant_id = $1
      AND cm.removed_at IS NULL
  )
)`;

export class ProjectPostgresRepository implements ProjectRepository {
  constructor(private readonly db: FastifyInstance['pg']) {}

  async create(
    input: ProjectAppearance & {
      name: string;
      about?: string | null;
      createdByHumanId: string;
    }
  ): Promise<Project> {
    const result = await this.db.query<ProjectRow>(
      `INSERT INTO endeavor.projects (id, name, created_by_human_id, context, icon, color)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [
        randomUUID(),
        input.name,
        input.createdByHumanId,
        JSON.stringify(input.about ? { about: input.about } : {}),
        input.icon ?? null,
        input.color ?? null
      ]
    );
    return toProject(result.rows[0]);
  }

  async getById(projectId: string): Promise<Project | null> {
    const result = await this.db.query<ProjectRow>(
      `SELECT * FROM endeavor.projects WHERE id = $1`,
      [projectId]
    );
    return result.rows[0] ? toProject(result.rows[0]) : null;
  }

  async getDefault(): Promise<Project | null> {
    const result = await this.db.query<ProjectRow>(
      `SELECT * FROM endeavor.projects WHERE is_default`
    );
    return result.rows[0] ? toProject(result.rows[0]) : null;
  }

  async list(input: {
    visibleToHumanId: string | null;
    archived: boolean;
    limit: number;
    offset: number;
  }): Promise<Project[]> {
    const result = await this.db.query<ProjectRow>(
      `SELECT p.*
       FROM endeavor.projects p
       WHERE ${VISIBLE_TO_HUMAN}
         AND (p.archived_at IS NOT NULL) = $2
       ORDER BY p.created_at DESC, p.id
       LIMIT $3 OFFSET $4`,
      [input.visibleToHumanId, input.archived, input.limit, input.offset]
    );
    return result.rows.map(toProject);
  }

  async count(input: { visibleToHumanId: string | null; archived: boolean }): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM endeavor.projects p
       WHERE ${VISIBLE_TO_HUMAN}
         AND (p.archived_at IS NOT NULL) = $2`,
      [input.visibleToHumanId, input.archived]
    );
    return result.rows[0].total;
  }

  async update(
    projectId: string,
    changes: ProjectAppearance & { name?: string; about?: string | null; archived?: boolean }
  ): Promise<Project | null> {
    const result = await this.db.query<ProjectRow>(
      `UPDATE endeavor.projects
       SET name = coalesce($2, name),
           archived_at = CASE
             WHEN $3::boolean IS NULL THEN archived_at
             WHEN $3 THEN coalesce(archived_at, now())
             ELSE NULL
           END,
           context = CASE WHEN $4::boolean
             THEN (context - 'about') || CASE WHEN $5::text IS NULL
               THEN '{}'::jsonb ELSE jsonb_build_object('about', $5::text) END
             ELSE context
           END,
           icon = CASE WHEN $6::boolean THEN $7::text ELSE icon END,
           color = CASE WHEN $8::boolean THEN $9::text ELSE color END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        projectId,
        changes.name ?? null,
        changes.archived ?? null,
        changes.about !== undefined,
        changes.about ?? null,
        changes.icon !== undefined,
        changes.icon ?? null,
        changes.color !== undefined,
        changes.color ?? null
      ]
    );
    return result.rows[0] ? toProject(result.rows[0]) : null;
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const result = await this.db.query<MemberRow>(
      `SELECT *
       FROM endeavor.project_members
       WHERE project_id = $1
         AND removed_at IS NULL
       ORDER BY added_at, participant_id`,
      [projectId]
    );
    return result.rows.map(toMember);
  }

  async setMembers(input: {
    projectId: string;
    participants: ParticipantRef[];
    addedByHumanId: string;
  }): Promise<void> {
    const types = input.participants.map((participant) => participant.type);
    const ids = input.participants.map((participant) => participant.id);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE endeavor.project_members pm
         SET removed_at = now()
         WHERE pm.project_id = $1
           AND pm.removed_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM unnest($2::text[], $3::uuid[]) AS keep(participant_type, participant_id)
             WHERE keep.participant_type = pm.participant_type
               AND keep.participant_id = pm.participant_id
           )`,
        [input.projectId, types, ids]
      );
      await client.query(
        `INSERT INTO endeavor.project_members (
           project_id, participant_type, participant_id, added_by_human_id
         )
         SELECT $1, keep.participant_type, keep.participant_id, $4
         FROM unnest($2::text[], $3::uuid[]) AS keep(participant_type, participant_id)
         ON CONFLICT (project_id, participant_type, participant_id) DO UPDATE
         SET removed_at = NULL,
             added_by_human_id = EXCLUDED.added_by_human_id,
             added_at = now()
         WHERE project_members.removed_at IS NOT NULL`,
        [input.projectId, types, ids, input.addedByHumanId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async hasHuman(projectId: string, humanId: string): Promise<boolean> {
    const result = await this.db.query<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM endeavor.projects p WHERE p.id = $2 AND ${VISIBLE_TO_HUMAN}
       ) AS found`,
      [humanId, projectId]
    );
    return result.rows[0].found;
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? null,
    color: row.color ?? null,
    about: row.context.about ?? null,
    isDefault: row.is_default,
    createdByHumanId: row.created_by_human_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toMember(row: MemberRow): ProjectMember {
  return {
    projectId: row.project_id,
    participant: { type: row.participant_type, id: row.participant_id },
    addedByHumanId: row.added_by_human_id,
    addedAt: row.added_at
  };
}
