import { FastifyInstance } from 'fastify';
import { CatalogPostgresRepository } from './catalog-postgres.repository';
import { CredentialCipher } from './credential-cipher';

function setup() {
  const query = jest.fn();
  const repository = new CatalogPostgresRepository(
    { query } as unknown as FastifyInstance['pg'],
    new CredentialCipher(undefined)
  );
  return { query, repository };
}

const oldVersion = {
  id: 'sv1',
  skill_id: 's1',
  version: 1,
  instructions: 'Read billing invoices.',
  connection_ids: ['c1'],
  created_by_human_id: null,
  created_at: new Date()
};

describe('catalog history compatibility', () => {
  it('omits retired associations from every skill version read without modifying history', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue({ rows: [oldVersion] });
    const [current] = await repository.getSkillVersions(['sv1']);
    const [historical] = await repository.listSkillVersions('s1');
    expect(current.instructions).toBe(oldVersion.instructions);
    expect(current).not.toHaveProperty('connectionIds');
    expect(historical).not.toHaveProperty('connectionIds');
    expect(oldVersion.connection_ids).toEqual(['c1']);
    expect(query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true);
  });

  it('cannot restore a grant revoked concurrently with configuration saving', async () => {
    const { query, repository } = setup();
    const revokedAt = new Date();
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          agent_id: 'a1',
          target_type: 'connection',
          target_id: 'c1',
          granted_by_human_id: 'h1',
          granted_at: new Date(),
          revoked_at: revokedAt
        }
      ]
    });
    const grant = await repository.grant({
      agentId: 'a1',
      targetType: 'connection',
      targetId: 'c1',
      grantedByHumanId: 'h1',
      restoreRevoked: false
    });
    expect(query.mock.calls[0][0]).toContain('AND $5::boolean');
    expect(query.mock.calls[0][1]).toEqual(['a1', 'connection', 'c1', 'h1', false]);
    expect(grant.revokedAt).toEqual(revokedAt);
  });
});
