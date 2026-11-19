import {
  mockCatalogRepository,
  mockHumanRepository,
  mockAgentRepository
} from '../../data/repositories.test-helper';
import { GrantLogger } from '../../observability';
import { Human, Skill, SkillVersion, Connection } from '../../shared/types';
import { GrantService } from './grant.service';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const AGENT = '00000000-0000-4000-8000-0000000000a1';

const admin: Human = {
  id: ADMIN,
  name: 'Kim',
  role: 'admin',
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
};
const skill: Skill = {
  id: 's1',
  name: 'Citations',
  description: 'Cite sources',
  currentVersionId: 'sv1',
  discoverable: false,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};
const skillVersion: SkillVersion = {
  id: 'sv1',
  skillId: 's1',
  version: 1,
  instructions: 'Cite every claim.',
  createdByHumanId: ADMIN,
  createdAt: new Date()
};
const connection: Connection = {
  id: 'c1',
  name: 'Docs',
  description: 'Docs API',
  baseUrl: 'https://docs.test',
  authHeader: 'Authorization',
  hasCredential: false,
  allowedMethods: ['GET'],
  allowedPathPrefixes: ['/'],
  approvalMethods: [],
  discoverable: false,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function setup() {
  const catalogs = mockCatalogRepository();
  const agents = mockAgentRepository();
  agents.addVersion.mockResolvedValue({ id: 'v2' } as never);
  const humans = mockHumanRepository();
  humans.getById.mockResolvedValue(admin);
  agents.getById.mockResolvedValue({ id: AGENT, currentVersionId: 'v1' } as never);
  agents.getVersion.mockResolvedValue({
    id: 'v1',
    instructions: 'Work carefully',
    provider: 'scripted',
    model: 'test',
    limits: {},
    skillVersionIds: [],
    connectionIds: []
  } as never);
  catalogs.getSkill.mockResolvedValue(skill);
  catalogs.getSkillVersions.mockResolvedValue([skillVersion]);
  catalogs.getConnection.mockResolvedValue(connection);
  const logger = {
    onGranted: jest.fn(),
    onRevoked: jest.fn()
  } as unknown as jest.Mocked<GrantLogger>;
  const service = new GrantService(catalogs, catalogs, catalogs, agents, humans, logger);
  return { service, catalogs, agents, humans, logger };
}

describe('GrantService', () => {
  it('grants only things that exist', async () => {
    const { service, catalogs } = setup();
    catalogs.getConnection.mockResolvedValue(null);

    await expect(
      service.grant(ADMIN, AGENT, { type: 'connection', id: 'nope' })
    ).rejects.toMatchObject({
      name: 'connectionNotFound'
    });
    expect(catalogs.grant).not.toHaveBeenCalled();
  });

  it('saves ongoing connection access as a new configuration version', async () => {
    const { service, agents, catalogs } = setup();
    await service.grant(ADMIN, AGENT, { type: 'connection', id: 'c1' });
    expect(agents.addVersion).toHaveBeenCalledWith(
      AGENT,
      expect.objectContaining({
        connectionIds: ['c1'],
        skillVersionIds: [],
        createdByHumanId: ADMIN
      }),
      {
        actorId: ADMIN,
        expectedVersionId: 'v1',
        grant: [{ type: 'connection', id: 'c1' }],
        revoke: []
      }
    );
    expect(catalogs.grant).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'c1' }));
  });

  it('saves ongoing skill access without changing independent connections', async () => {
    const { service, agents } = setup();
    await service.grant(ADMIN, AGENT, { type: 'skill', id: 's1' });
    expect(agents.addVersion.mock.calls[0][1]).toMatchObject({
      skillVersionIds: ['sv1'],
      connectionIds: []
    });
  });

  it('does not add duplicate versions for access already chosen', async () => {
    const { service, agents } = setup();
    agents.getVersion.mockResolvedValue({
      instructions: 'i',
      provider: 'scripted',
      model: 'm',
      limits: {},
      skillVersionIds: [],
      connectionIds: ['c1']
    } as never);
    await service.grant(ADMIN, AGENT, { type: 'connection', id: 'c1' });
    expect(agents.addVersion).not.toHaveBeenCalled();
  });

  it('does not grant ongoing access if its configuration save fails', async () => {
    const { service, agents, catalogs } = setup();
    agents.addVersion.mockRejectedValue(new Error('Save failed'));
    await expect(service.grant(ADMIN, AGENT, { type: 'connection', id: 'c1' })).rejects.toThrow(
      'Save failed'
    );
    expect(catalogs.grant).not.toHaveBeenCalled();
  });

  it('logs a revoke only when something was revoked', async () => {
    const { service, catalogs, logger } = setup();
    catalogs.revoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await service.revoke(ADMIN, AGENT, { type: 'skill', id: 's1' });
    await service.revoke(ADMIN, AGENT, { type: 'skill', id: 's1' });

    expect(logger.onRevoked).toHaveBeenCalledTimes(1);
  });
});
