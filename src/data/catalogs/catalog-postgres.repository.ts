import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  AgentGrant,
  Connection,
  GrantTargetType,
  HttpMethod,
  Skill,
  SkillVersion
} from '../../shared/types';
import {
  CatalogNameConflictError,
  CatalogRepository,
  ConnectionInput,
  CreateSkillVersionInput
} from './catalog.repository';
import { CredentialCipher } from './credential-cipher';

interface SkillRow {
  id: string;
  name: string;
  description: string;
  current_version_id: string | null;
  disabled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SkillVersionRow {
  id: string;
  skill_id: string;
  version: number;
  instructions: string;
  connection_ids: string[];
  created_by_human_id: string | null;
  created_at: Date | string;
}

interface ConnectionRow {
  id: string;
  name: string;
  description: string;
  base_url: string;
  auth_header: string;
  credential_ciphertext: string | null;
  allowed_methods: HttpMethod[];
  allowed_path_prefixes: string[];
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface GrantRow {
  agent_id: string;
  target_type: GrantTargetType;
  target_id: string;
  granted_by_human_id: string | null;
  granted_at: Date;
  revoked_at: Date | null;
}

const UNIQUE_VIOLATION = '23505';
const NAME_INDEXES = new Set(['idx_skills_name_unique', 'idx_connections_name_unique']);
const UPDATABLE_CONNECTION_COLUMNS = {
  name: 'name',
  description: 'description',
  baseUrl: 'base_url',
  authHeader: 'auth_header',
  allowedMethods: 'allowed_methods',
  allowedPathPrefixes: 'allowed_path_prefixes'
} as const;

export class CatalogPostgresRepository implements CatalogRepository {
  constructor(
    private readonly db: FastifyInstance['pg'],
    private readonly cipher: CredentialCipher
  ) {}

  async createSkill(
    input: { name: string; description: string },
    firstVersion: CreateSkillVersionInput
  ): Promise<{ skill: Skill; version: SkillVersion }> {
    const skillId = randomUUID();
    const versionId = randomUUID();
    const result = await this.db
      .query<{ skill: SkillRow; version: SkillVersionRow }>(
        `WITH skill AS (
           INSERT INTO bold_cedar_007.skills (id, name, description, current_version_id)
           VALUES ($1, $2, $3, $4)
           RETURNING *
         ), version AS (
           INSERT INTO bold_cedar_007.skill_versions (
             id, skill_id, version, instructions, connection_ids, created_by_human_id
           )
           SELECT $4, skill.id, 1, $5, $6, $7
           FROM skill
           RETURNING *
         )
         SELECT row_to_json(skill.*) AS skill, row_to_json(version.*) AS version
         FROM skill, version`,
        [
          skillId,
          input.name,
          input.description,
          versionId,
          firstVersion.instructions,
          firstVersion.connectionIds,
          firstVersion.createdByHumanId
        ]
      )
      .catch((error) => rethrowNameConflict(error, input.name));

    const row = result.rows[0];
    return { skill: toSkill(row.skill), version: toSkillVersion(row.version) };
  }

  async getSkill(skillId: string): Promise<Skill | null> {
    const result = await this.db.query<SkillRow>(
      `SELECT * FROM bold_cedar_007.skills WHERE id = $1`,
      [skillId]
    );
    return result.rows[0] ? toSkill(result.rows[0]) : null;
  }

  async getSkills(skillIds: string[]): Promise<Skill[]> {
    if (skillIds.length === 0) {
      return [];
    }
    const result = await this.db.query<SkillRow>(
      `SELECT * FROM bold_cedar_007.skills WHERE id = ANY($1::uuid[])`,
      [skillIds]
    );
    return result.rows.map(toSkill);
  }

  async listSkills(input: { limit: number; offset: number }): Promise<Skill[]> {
    const result = await this.db.query<SkillRow>(
      `SELECT *
       FROM bold_cedar_007.skills
       ORDER BY lower(name)
       LIMIT $1 OFFSET $2`,
      [input.limit, input.offset]
    );
    return result.rows.map(toSkill);
  }

  async countSkills(): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM bold_cedar_007.skills`
    );
    return result.rows[0].total;
  }

  // Two saves at once can pick the same number; the unique index rejects one, which retries.
  async addSkillVersion(skillId: string, input: CreateSkillVersionInput): Promise<SkillVersion> {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.db.query<SkillVersionRow>(
          `WITH next AS (
             SELECT coalesce(max(version), 0) + 1 AS version
             FROM bold_cedar_007.skill_versions
             WHERE skill_id = $2
           ), saved AS (
             INSERT INTO bold_cedar_007.skill_versions (
               id, skill_id, version, instructions, connection_ids, created_by_human_id
             )
             SELECT $1, $2, next.version, $3, $4, $5
             FROM next
             RETURNING *
           ), current AS (
             UPDATE bold_cedar_007.skills
             SET current_version_id = (SELECT id FROM saved), updated_at = now()
             WHERE id = $2
           )
           SELECT * FROM saved`,
          [randomUUID(), skillId, input.instructions, input.connectionIds, input.createdByHumanId]
        );
        return toSkillVersion(result.rows[0]);
      } catch (error) {
        if (attempt >= 3 || (error as { code?: string }).code !== UNIQUE_VIOLATION) {
          throw error;
        }
      }
    }
  }

  async getSkillVersions(versionIds: string[]): Promise<SkillVersion[]> {
    if (versionIds.length === 0) {
      return [];
    }
    const result = await this.db.query<SkillVersionRow>(
      `SELECT * FROM bold_cedar_007.skill_versions WHERE id = ANY($1::uuid[])`,
      [versionIds]
    );
    return result.rows.map(toSkillVersion);
  }

  async listSkillVersions(skillId: string): Promise<SkillVersion[]> {
    const result = await this.db.query<SkillVersionRow>(
      `SELECT *
       FROM bold_cedar_007.skill_versions
       WHERE skill_id = $1
       ORDER BY version DESC`,
      [skillId]
    );
    return result.rows.map(toSkillVersion);
  }

  async setSkillDisabled(skillId: string, disabled: boolean): Promise<Skill | null> {
    const result = await this.db.query<SkillRow>(
      `UPDATE bold_cedar_007.skills
       SET disabled_at = CASE WHEN $2 THEN coalesce(disabled_at, now()) ELSE NULL END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [skillId, disabled]
    );
    return result.rows[0] ? toSkill(result.rows[0]) : null;
  }

  async createConnection(input: ConnectionInput): Promise<Connection> {
    const result = await this.db
      .query<ConnectionRow>(
        `INSERT INTO bold_cedar_007.connections (
           id, name, description, base_url, auth_header, credential_ciphertext, allowed_methods,
           allowed_path_prefixes, created_by_human_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          randomUUID(),
          input.name,
          input.description,
          input.baseUrl,
          input.authHeader,
          input.credential === null ? null : this.cipher.encrypt(input.credential),
          input.allowedMethods,
          input.allowedPathPrefixes,
          input.createdByHumanId
        ]
      )
      .catch((error) => rethrowNameConflict(error, input.name));
    return toConnection(result.rows[0]);
  }

  async getConnection(connectionId: string): Promise<Connection | null> {
    const result = await this.db.query<ConnectionRow>(
      `SELECT * FROM bold_cedar_007.connections WHERE id = $1`,
      [connectionId]
    );
    return result.rows[0] ? toConnection(result.rows[0]) : null;
  }

  async getConnections(connectionIds: string[]): Promise<Connection[]> {
    if (connectionIds.length === 0) {
      return [];
    }
    const result = await this.db.query<ConnectionRow>(
      `SELECT * FROM bold_cedar_007.connections WHERE id = ANY($1::uuid[])`,
      [connectionIds]
    );
    return result.rows.map(toConnection);
  }

  async listConnections(input: { limit: number; offset: number }): Promise<Connection[]> {
    const result = await this.db.query<ConnectionRow>(
      `SELECT *
       FROM bold_cedar_007.connections
       ORDER BY lower(name)
       LIMIT $1 OFFSET $2`,
      [input.limit, input.offset]
    );
    return result.rows.map(toConnection);
  }

  async countConnections(): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM bold_cedar_007.connections`
    );
    return result.rows[0].total;
  }

  async updateConnection(
    connectionId: string,
    changes: Partial<Omit<ConnectionInput, 'createdByHumanId'>>
  ): Promise<Connection | null> {
    const values: unknown[] = [connectionId];
    const sets = ['updated_at = now()'];
    for (const [field, column] of Object.entries(UPDATABLE_CONNECTION_COLUMNS)) {
      const value = changes[field as keyof typeof UPDATABLE_CONNECTION_COLUMNS];
      if (value !== undefined) {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (changes.credential !== undefined) {
      values.push(changes.credential === null ? null : this.cipher.encrypt(changes.credential));
      sets.push(`credential_ciphertext = $${values.length}`);
    }

    const result = await this.db
      .query<ConnectionRow>(
        `UPDATE bold_cedar_007.connections
         SET ${sets.join(', ')}
         WHERE id = $1
         RETURNING *`,
        values
      )
      .catch((error) => rethrowNameConflict(error, changes.name ?? ''));
    return result.rows[0] ? toConnection(result.rows[0]) : null;
  }

  async setConnectionDisabled(connectionId: string, disabled: boolean): Promise<Connection | null> {
    const result = await this.db.query<ConnectionRow>(
      `UPDATE bold_cedar_007.connections
       SET disabled_at = CASE WHEN $2 THEN coalesce(disabled_at, now()) ELSE NULL END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [connectionId, disabled]
    );
    return result.rows[0] ? toConnection(result.rows[0]) : null;
  }

  async getConnectionCredential(connectionId: string): Promise<string | null> {
    const result = await this.db.query<{ credential_ciphertext: string | null }>(
      `SELECT credential_ciphertext FROM bold_cedar_007.connections WHERE id = $1`,
      [connectionId]
    );
    const stored = result.rows[0]?.credential_ciphertext;
    return stored ? this.cipher.decrypt(stored) : null;
  }

  async grant(input: {
    agentId: string;
    targetType: GrantTargetType;
    targetId: string;
    grantedByHumanId: string;
  }): Promise<AgentGrant> {
    const result = await this.db.query<GrantRow>(
      `INSERT INTO bold_cedar_007.agent_grants (agent_id, target_type, target_id, granted_by_human_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (agent_id, target_type, target_id) DO UPDATE
       SET granted_by_human_id = EXCLUDED.granted_by_human_id,
           granted_at = now(),
           revoked_at = NULL,
           revoked_by_human_id = NULL
       WHERE agent_grants.revoked_at IS NOT NULL
       RETURNING *`,
      [input.agentId, input.targetType, input.targetId, input.grantedByHumanId]
    );
    if (result.rows[0]) {
      return toGrant(result.rows[0]);
    }
    // Already active: return it unchanged.
    const existing = await this.db.query<GrantRow>(
      `SELECT * FROM bold_cedar_007.agent_grants
       WHERE agent_id = $1 AND target_type = $2 AND target_id = $3`,
      [input.agentId, input.targetType, input.targetId]
    );
    return toGrant(existing.rows[0]);
  }

  async revoke(input: {
    agentId: string;
    targetType: GrantTargetType;
    targetId: string;
    revokedByHumanId: string;
  }): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE bold_cedar_007.agent_grants
       SET revoked_at = now(), revoked_by_human_id = $4
       WHERE agent_id = $1
         AND target_type = $2
         AND target_id = $3
         AND revoked_at IS NULL`,
      [input.agentId, input.targetType, input.targetId, input.revokedByHumanId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listGrants(agentId: string, options: { activeOnly: boolean }): Promise<AgentGrant[]> {
    const result = await this.db.query<GrantRow>(
      `SELECT *
       FROM bold_cedar_007.agent_grants
       WHERE agent_id = $1
         AND ($2::boolean = false OR revoked_at IS NULL)
       ORDER BY target_type, granted_at`,
      [agentId, options.activeOnly]
    );
    return result.rows.map(toGrant);
  }
}

function rethrowNameConflict(error: unknown, name: string): never {
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code === UNIQUE_VIOLATION && constraint && NAME_INDEXES.has(constraint)) {
    throw new CatalogNameConflictError(name);
  }
  throw error;
}

// row_to_json returns timestamps as strings, so accept both.
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    disabledAt: row.disabled_at === null ? null : toDate(row.disabled_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at)
  };
}

function toSkillVersion(row: SkillVersionRow): SkillVersion {
  return {
    id: row.id,
    skillId: row.skill_id,
    version: row.version,
    instructions: row.instructions,
    connectionIds: row.connection_ids,
    createdByHumanId: row.created_by_human_id,
    createdAt: toDate(row.created_at)
  };
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baseUrl: row.base_url,
    authHeader: row.auth_header,
    hasCredential: row.credential_ciphertext !== null,
    allowedMethods: row.allowed_methods,
    allowedPathPrefixes: row.allowed_path_prefixes,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toGrant(row: GrantRow): AgentGrant {
  return {
    agentId: row.agent_id,
    targetType: row.target_type,
    targetId: row.target_id,
    grantedByHumanId: row.granted_by_human_id,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at
  };
}
