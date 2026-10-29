import { CatalogNameConflictError } from '../../data';
import { mockCatalogRepository, mockHumanRepository } from '../../data/repositories.test-helper';
import { ConnectionLogger } from '../../observability';
import { Human, Connection } from '../../shared/types';
import { ConnectionService } from './connection.service';

const ADMIN = '00000000-0000-4000-8000-000000000001';

const admin: Human = {
  id: ADMIN,
  name: 'Kim',
  role: 'admin',
  preferences: { theme: 'system', timeFormat: '12h' },
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
  const humans = mockHumanRepository();
  humans.getById.mockResolvedValue(admin);
  catalogs.getConnection.mockResolvedValue(connection);
  catalogs.getConnections.mockImplementation(async (ids) =>
    ids.includes('c1') ? [connection] : []
  );
  catalogs.createConnection.mockResolvedValue(connection);
  const logger = {
    onConnectionSaved: jest.fn()
  } as unknown as jest.Mocked<ConnectionLogger>;
  const service = new ConnectionService(catalogs, humans, credentialsReady, logger);
  return { service, catalogs, humans, logger };
}

describe('ConnectionService', () => {
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
});
