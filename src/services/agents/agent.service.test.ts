import { AgentNameConflictError } from '../../data';
import {
  mockAgentRepository,
  mockCatalogRepository,
  mockHumanRepository
} from '../../data/repositories.test-helper';
import { AgentLogger } from '../../observability';
import { Agent, AgentVersion, Human } from '../../shared/types';
import { AgentService } from './agent.service';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const AGENT_ID = '00000000-0000-4000-8000-0000000000a1';

const admin: Human = { id: ADMIN_ID, name: 'Kim', role: 'admin', createdAt: new Date() };

const agent: Agent = {
  id: AGENT_ID,
  name: 'QA',
  purpose: 'Tests the staging site',
  currentVersionId: 'v1',
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

const version1: AgentVersion = {
  id: 'v1',
  agentId: AGENT_ID,
  version: 1,
  instructions: 'Test the checkout flow',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  skillVersionIds: ['s1'],
  connectionIds: ['c1'],
  createdByHumanId: ADMIN_ID,
  createdAt: new Date()
};

function setup(ready: ('anthropic' | 'openai' | 'scripted')[] = ['anthropic', 'scripted']) {
  const agents = mockAgentRepository();
  agents.create.mockImplementation(async (_input, first) => ({
    agent: { ...agent, currentVersionId: 'v1' },
    version: { ...version1, ...first }
  }));
  agents.getById.mockResolvedValue(agent);
  agents.list.mockResolvedValue([agent]);
  agents.count.mockResolvedValue(1);
  agents.setDisabled.mockResolvedValue({ ...agent, disabledAt: new Date() });
  agents.addVersion.mockImplementation(async (_id, input) => ({
    ...version1,
    ...input,
    id: 'v2',
    version: 2
  }));
  agents.getVersion.mockResolvedValue(version1);
  agents.getVersions.mockResolvedValue([version1]);
  const humans = mockHumanRepository();
  humans.getById.mockResolvedValue(admin);
  const logger = {
    onAgentCreated: jest.fn(),
    onAgentConfigured: jest.fn(),
    onAgentDisabled: jest.fn(),
    onAgentEnabled: jest.fn()
  } as unknown as jest.Mocked<AgentLogger>;
  const catalogs = mockCatalogRepository();
  return {
    service: new AgentService(agents, humans, catalogs, ready, logger),
    agents,
    humans,
    catalogs,
    logger
  };
}

describe('AgentService', () => {
  it('creates an agent with version 1 of its configuration', async () => {
    const { service, agents } = setup();

    const details = await service.createAgent(ADMIN_ID, {
      name: 'QA',
      purpose: 'Tests the staging site',
      instructions: 'Test the checkout flow',
      provider: 'openai',
      model: 'gpt-test'
    });

    expect(agents.create).toHaveBeenCalledWith(
      { name: 'QA', purpose: 'Tests the staging site' },
      {
        instructions: 'Test the checkout flow',
        provider: 'openai',
        model: 'gpt-test',
        skillVersionIds: [],
        connectionIds: [],
        createdByHumanId: ADMIN_ID
      }
    );
    expect(details.currentVersion?.version).toBe(1);
    // openai has no key in this setup, so the agent is saved but flagged as not ready.
    expect(details.providerReady).toBe(false);
  });

  it('rejects a name that is taken', async () => {
    const { service, agents } = setup();
    agents.getByName.mockResolvedValue(agent);

    await expect(
      service.createAgent(ADMIN_ID, {
        name: 'qa',
        purpose: 'p',
        instructions: 'i',
        provider: 'scripted',
        model: 'm'
      })
    ).rejects.toMatchObject({ name: 'agentNameTaken' });
  });

  it('only lets admins change agents', async () => {
    const { service, humans } = setup();
    humans.getById.mockResolvedValue({ ...admin, role: 'member' });

    await expect(
      service.updateConfig(ADMIN_ID, AGENT_ID, { instructions: 'New' })
    ).rejects.toMatchObject({ name: 'forbidden' });
  });

  it('saves a config change as a new version that keeps the rest', async () => {
    const { service, agents } = setup();

    const details = await service.updateConfig(ADMIN_ID, AGENT_ID, { model: 'claude-sonnet-5-5' });

    expect(agents.addVersion).toHaveBeenCalledWith(AGENT_ID, {
      instructions: 'Test the checkout flow',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      skillVersionIds: ['s1'],
      connectionIds: ['c1'],
      createdByHumanId: ADMIN_ID
    });
    expect(details.currentVersion?.version).toBe(2);
    expect(details.providerReady).toBe(true);
  });

  it('needs a full configuration when the agent has none', async () => {
    const { service, agents } = setup();
    agents.getById.mockResolvedValue({ ...agent, currentVersionId: null });

    await expect(service.updateConfig(ADMIN_ID, AGENT_ID, { model: 'x' })).rejects.toMatchObject({
      name: 'validationError'
    });
  });

  it('allows renaming to a different case of the same name', async () => {
    const { service, agents } = setup();
    agents.getByName.mockResolvedValue(agent);
    agents.update.mockResolvedValue({ ...agent, name: 'qa' });

    const details = await service.updateProfile(ADMIN_ID, AGENT_ID, { name: 'qa' });

    expect(details.name).toBe('qa');
  });

  it('disables an agent', async () => {
    const { service, logger } = setup();

    const details = await service.setDisabled(ADMIN_ID, AGENT_ID, true);

    expect(details.disabledAt).not.toBeNull();
    expect(logger.onAgentDisabled).toHaveBeenCalledWith(AGENT_ID);
  });

  it('changes and logs nothing when the agent is already disabled', async () => {
    const { service, agents, logger } = setup();
    agents.getById.mockResolvedValue({ ...agent, disabledAt: new Date() });

    await service.setDisabled(ADMIN_ID, AGENT_ID, true);

    expect(agents.setDisabled).not.toHaveBeenCalled();
    expect(logger.onAgentDisabled).not.toHaveBeenCalled();
  });

  it('does not save a new version when nothing changed', async () => {
    const { service, agents } = setup();

    const details = await service.updateConfig(ADMIN_ID, AGENT_ID, { model: 'claude-opus-5-5' });

    expect(agents.addVersion).not.toHaveBeenCalled();
    expect(details.currentVersion?.version).toBe(1);
  });

  it('turns a name clash from the database into agentNameTaken', async () => {
    const { service, agents } = setup();
    agents.create.mockRejectedValue(new AgentNameConflictError('QA'));

    await expect(
      service.createAgent(ADMIN_ID, {
        name: 'QA',
        purpose: 'p',
        instructions: 'i',
        provider: 'scripted',
        model: 'm'
      })
    ).rejects.toMatchObject({ name: 'agentNameTaken' });
  });

  it('loads all current versions for a list in one call', async () => {
    const { service, agents } = setup();

    const { agents: listed } = await service.listAgents({
      limit: 10,
      offset: 0,
      includeDisabled: false
    });

    expect(agents.getVersions).toHaveBeenCalledWith(['v1']);
    expect(agents.getVersion).not.toHaveBeenCalled();
    expect(listed[0].currentVersion?.id).toBe('v1');
  });

  it('lists the directory with purpose and capabilities only', async () => {
    const { service, agents } = setup();
    agents.listDirectory.mockResolvedValue([agent]);
    agents.countDirectory.mockResolvedValue(1);

    const { entries, total } = await service.listDirectory(ADMIN_ID, { limit: 10, offset: 0 });

    expect(total).toBe(1);

    expect(entries).toEqual([
      {
        id: AGENT_ID,
        name: 'QA',
        purpose: 'Tests the staging site',
        capabilities: {
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          skillCount: 1,
          connectionCount: 1
        }
      }
    ]);
    expect(JSON.stringify(entries)).not.toContain('Test the checkout flow');
  });

  it('pins chosen skills at their current version and grants them', async () => {
    const { service, catalogs, agents } = setup();
    catalogs.getSkills.mockResolvedValue([
      {
        id: 's1',
        name: 'Citations',
        description: '',
        currentVersionId: 'sv7',
        disabledAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
    // version1 pinned nothing yet; the new version pins sv7, which uses connection c9.
    catalogs.getSkillVersions.mockImplementation(async (ids) =>
      ids.includes('sv7')
        ? [
            {
              id: 'sv7',
              skillId: 's1',
              version: 7,
              instructions: 'Cite',
              connectionIds: ['c9'],
              createdByHumanId: null,
              createdAt: new Date()
            }
          ]
        : []
    );

    await service.updateConfig(ADMIN_ID, AGENT_ID, { skillIds: ['s1'] });

    expect(agents.addVersion).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({ skillVersionIds: ['sv7'] })
    );
    const granted = catalogs.grant.mock.calls.map(
      ([input]) => `${input.targetType}:${input.targetId}`
    );
    // c1 was already chosen in version 1, so it is not granted again.
    expect(granted).toEqual(['skill:s1', 'connection:c9']);
  });

  it('never re-grants an entry that was already chosen, so revokes stick', async () => {
    const { service, catalogs } = setup();
    catalogs.getConnections.mockResolvedValue([{ id: 'c1', disabledAt: null } as never]);

    await service.updateConfig(ADMIN_ID, AGENT_ID, { connectionIds: ['c1'], model: 'other' });

    expect(catalogs.grant).not.toHaveBeenCalled();
  });

  it('refuses a disabled skill', async () => {
    const { service, catalogs } = setup();
    catalogs.getSkills.mockResolvedValue([
      {
        id: 's1',
        name: 'Old',
        description: '',
        currentVersionId: 'sv1',
        disabledAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    await expect(
      service.updateConfig(ADMIN_ID, AGENT_ID, { skillIds: ['s1'] })
    ).rejects.toMatchObject({
      name: 'catalogEntryUnavailable'
    });
  });

  it('reports which providers are ready', () => {
    const { service } = setup(['scripted']);

    expect(service.listProviders().map(({ provider, ready }) => [provider, ready])).toEqual([
      ['anthropic', false],
      ['openai', false],
      ['scripted', true]
    ]);
  });
});
