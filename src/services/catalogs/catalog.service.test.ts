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

const admin: Human = { id: ADMIN, name: 'Kim', role: 'admin', createdAt: new Date() };
const skill: Skill = {
  id: 's1',
  name: 'Citations',
  description: 'Cite sources',
  currentVersionId: 'sv1',
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};
const skillVersion: SkillVersion = {
  id: 'sv1',
  skillId: 's1',
  version: 1,
  instructions: 'Cite every claim.',
  connectionIds: [],
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
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function setup(credentialsReady = true) {
  const catalogs = mockCatalogRepository();
  const agents = mockAgentRepository();
  const humans = mockHumanRepository();
  humans.getById.mockResolvedValue(admin);
  agents.getById.mockResolvedValue({ id: AGENT } as never);
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
      { instructions: 'Cite every claim.', connectionIds: [], createdByHumanId: ADMIN }
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

    const updated = await service.addSkillVersion(ADMIN, 's1', { connectionIds: ['c1'] });

    expect(catalogs.addSkillVersion).toHaveBeenCalledWith('s1', {
      instructions: 'Cite every claim.',
      connectionIds: ['c1'],
      createdByHumanId: ADMIN
    });
    expect(updated.currentVersion?.version).toBe(2);
  });

  it('rejects unknown connections on a skill', async () => {
    const { service } = setup();

    await expect(
      service.addSkillVersion(ADMIN, 's1', { connectionIds: ['missing'] })
    ).rejects.toMatchObject({ name: 'connectionNotFound' });
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

  it('logs a revoke only when something was revoked', async () => {
    const { service, catalogs, logger } = setup();
    catalogs.revoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await service.revoke(ADMIN, AGENT, { type: 'skill', id: 's1' });
    await service.revoke(ADMIN, AGENT, { type: 'skill', id: 's1' });

    expect(logger.onRevoked).toHaveBeenCalledTimes(1);
  });
});
