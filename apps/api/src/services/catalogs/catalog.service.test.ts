import { CatalogNameConflictError } from '../../data';
import {
  mockAgentRepository,
  mockCatalogRepository,
  mockHumanRepository
} from '../../data/repositories.test-helper';
import { CatalogLogger } from '../../observability';
import { Connection, Human, Skill, SkillVersion } from '../../shared/types';
import { CatalogService } from './catalog.service';

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

function setup(credentialsReady = true) {
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
  catalogs.getConnections.mockImplementation(async (ids) =>
    ids.includes('c1') ? [connection] : []
  );
  catalogs.createSkill.mockResolvedValue({ skill, version: skillVersion });
  catalogs.createConnection.mockResolvedValue(connection);
  catalogs.addSkillVersion.mockImplementation(async (_id, input) => ({
    ...skillVersion,
    ...input,
    id: 'sv2',
    version: 2
  }));
  const logger = {
    onSkillSaved: jest.fn(),
    onSkillDiscoveryChanged: jest.fn(),
    onConnectionSaved: jest.fn(),
    onGranted: jest.fn(),
    onRevoked: jest.fn()
  } as unknown as jest.Mocked<CatalogLogger>;
  const service = new CatalogService(catalogs, agents, humans, credentialsReady, logger);
  return { service, catalogs, agents, humans, logger };
}

describe('CatalogService', () => {
  it('creates a skill with version 1', async () => {
    const { service, catalogs } = setup();

    const created = await service.createSkill(ADMIN, {
      name: 'Citations',
      description: 'Cite sources',
      instructions: 'Cite every claim.'
    });

    expect(created.currentVersion?.version).toBe(1);
    expect(catalogs.createSkill).toHaveBeenCalledWith(
      { name: 'Citations', description: 'Cite sources' },
      { instructions: 'Cite every claim.', createdByHumanId: ADMIN }
    );
  });

  it('lets any person change catalogs, since v1 has one role', async () => {
    const { service, humans } = setup();
    humans.getById.mockResolvedValue({ ...admin, role: 'member' });

    const outcome = await service
      .createSkill(ADMIN, { name: 'x', description: 'y', instructions: 'z' })
      .catch((error: unknown) => error);
    expect(outcome).not.toMatchObject({ name: 'forbidden' });
  });

  it('makes every method but GET need approval on a new connection, unless told otherwise', async () => {
    const { service, catalogs } = setup();
    catalogs.createConnection.mockResolvedValue(connection);
    const input = {
      name: 'Issues',
      description: 'd',
      baseUrl: 'https://issues.test',
      allowedMethods: ['GET', 'POST', 'DELETE'] as ('GET' | 'POST' | 'DELETE')[],
      allowedPathPrefixes: ['/']
    };

    await service.createConnection(ADMIN, input);
    await service.createConnection(ADMIN, { ...input, approvalMethods: [] });

    expect(catalogs.createConnection.mock.calls[0][0].approvalMethods).toEqual(['POST', 'DELETE']);
    expect(catalogs.createConnection.mock.calls[1][0].approvalMethods).toEqual([]);
  });

  it('turns a name clash into catalogNameTaken', async () => {
    const { service, catalogs } = setup();
    catalogs.createConnection.mockRejectedValue(new CatalogNameConflictError('Docs'));

    await expect(
      service.createConnection(ADMIN, {
        name: 'Docs',
        description: 'd',
        baseUrl: 'https://docs.test',
        allowedMethods: ['GET'],
        allowedPathPrefixes: ['/']
      })
    ).rejects.toMatchObject({ name: 'catalogNameTaken' });
  });

  it('refuses to store a credential without CREDENTIALS_KEY', async () => {
    const { service, catalogs } = setup(false);

    await expect(
      service.createConnection(ADMIN, {
        name: 'Docs',
        description: 'd',
        baseUrl: 'https://docs.test',
        credential: 'Bearer x',
        allowedMethods: ['GET'],
        allowedPathPrefixes: ['/']
      })
    ).rejects.toMatchObject({ name: 'credentialsKeyMissing' });
    expect(catalogs.createConnection).not.toHaveBeenCalled();
  });

  it('allows removing a credential without CREDENTIALS_KEY', async () => {
    const { service, catalogs } = setup(false);
    catalogs.updateConnection.mockResolvedValue(connection);

    await service.updateConnection(ADMIN, 'c1', { credential: null });

    expect(catalogs.updateConnection).toHaveBeenCalledWith('c1', { credential: null });
  });

  it('saves a new skill version from the current one', async () => {
    const { service, catalogs } = setup();

    const updated = await service.addSkillVersion(ADMIN, 's1', {
      instructions: 'Cite each source.'
    });

    expect(catalogs.addSkillVersion).toHaveBeenCalledWith('s1', {
      instructions: 'Cite each source.',
      createdByHumanId: ADMIN
    });
    expect(updated.currentVersion?.version).toBe(2);
  });

  it('never checks connections or grants access when creating or versioning instructions', async () => {
    const { service, catalogs } = setup();
    await service.createSkill(ADMIN, {
      name: 'Billing',
      description: 'Billing',
      instructions: 'Use Billing API.'
    });
    await service.addSkillVersion(ADMIN, 's1', { instructions: 'Use another API.' });
    expect(catalogs.getConnections).not.toHaveBeenCalled();
    expect(catalogs.grant).not.toHaveBeenCalled();
  });

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

describe('MCP catalog policy', () => {
  it('defaults every allowed MCP tool to requiring approval', async () => {
    const { service, catalogs } = setup();
    await service.createConnection(ADMIN, {
      kind: 'mcp',
      name: 'Records',
      description: 'Record tools',
      baseUrl: 'https://records.test/mcp',
      allowedTools: ['lookup', 'create']
    });
    expect(catalogs.createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'mcp',
        allowedTools: ['lookup', 'create'],
        approvalTools: ['lookup', 'create'],
        allowedMethods: [],
        allowedPathPrefixes: []
      })
    );
  });

  it('requires approval for newly allowed tools when changing only the allowlist', async () => {
    const { service, catalogs } = setup();
    catalogs.getConnection.mockResolvedValue({
      ...connection,
      kind: 'mcp',
      allowedTools: ['lookup'],
      approvalTools: []
    });
    catalogs.updateConnection.mockResolvedValue(connection);
    await service.updateConnection(ADMIN, 'c1', { allowedTools: ['lookup', 'create'] });
    expect(catalogs.updateConnection).toHaveBeenCalledWith('c1', {
      allowedTools: ['lookup', 'create'],
      approvalTools: ['create']
    });
  });

  it('rejects tool settings on HTTP connections and HTTP policy on MCP connections', async () => {
    const { service, catalogs } = setup();
    await expect(
      service.updateConnection(ADMIN, 'c1', { allowedTools: ['lookup'] })
    ).rejects.toThrow('HTTP permissions');
    catalogs.getConnection.mockResolvedValue({ ...connection, kind: 'mcp' });
    await expect(service.updateConnection(ADMIN, 'c1', { approvalMethods: [] })).rejects.toThrow(
      'MCP permissions'
    );
    expect(catalogs.updateConnection).not.toHaveBeenCalled();
  });
});

describe('catalog discovery', () => {
  it('keeps new entries private unless a person marks them discoverable', async () => {
    const { service, catalogs } = setup();
    await service.createConnection(ADMIN, {
      name: 'Wikipedia',
      description: 'Read pages',
      baseUrl: 'https://wiki.test',
      allowedMethods: ['GET'],
      allowedPathPrefixes: ['/wiki']
    });
    expect(catalogs.createConnection).toHaveBeenCalledWith(
      expect.objectContaining({ discoverable: false })
    );
  });

  it('marks a skill discoverable without granting any agent access', async () => {
    const { service, catalogs } = setup();
    await service.updateSkill(ADMIN, skill.id, { discoverable: true });
    expect(catalogs.setSkillDiscoverable).toHaveBeenCalledWith(skill.id, true);
    expect(catalogs.grant).not.toHaveBeenCalled();
  });
});
