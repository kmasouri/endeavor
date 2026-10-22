import { AgentNameConflictError, AgentRepository, HumanRepository } from '../../data';
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
  skillIds: ['s1'],
  connectionIds: ['c1'],
  createdByHumanId: ADMIN_ID,
  createdAt: new Date()
};

function setup(ready: ('anthropic' | 'openai' | 'scripted')[] = ['anthropic', 'scripted']) {
  const agents: jest.Mocked<AgentRepository> = {
    create: jest.fn(async (_input, first) => ({
      agent: { ...agent, currentVersionId: 'v1' },
      version: { ...version1, ...first }
    })),
    getById: jest.fn().mockResolvedValue(agent),
    getByName: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([agent]),
    count: jest.fn().mockResolvedValue(1),
    update: jest.fn(),
    setDisabled: jest.fn().mockResolvedValue({ ...agent, disabledAt: new Date() }),
    addVersion: jest.fn(async (_id, input) => ({ ...version1, ...input, id: 'v2', version: 2 })),
    getVersion: jest.fn().mockResolvedValue(version1),
    getVersions: jest.fn().mockResolvedValue([version1]),
    listVersions: jest.fn()
  };
  const humans: jest.Mocked<HumanRepository> = {
    create: jest.fn(),
    createFirst: jest.fn(),
    getById: jest.fn().mockResolvedValue(admin),
    list: jest.fn(),
    count: jest.fn()
  };
  const logger = {
    onAgentCreated: jest.fn(),
    onAgentConfigured: jest.fn(),
    onAgentDisabled: jest.fn(),
    onAgentEnabled: jest.fn()
  } as unknown as jest.Mocked<AgentLogger>;
  return { service: new AgentService(agents, humans, ready, logger), agents, humans, logger };
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
        skillIds: [],
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
      skillIds: ['s1'],
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

  it('reports which providers are ready', () => {
    const { service } = setup(['scripted']);

    expect(service.listProviders().map(({ provider, ready }) => [provider, ready])).toEqual([
      ['anthropic', false],
      ['openai', false],
      ['scripted', true]
    ]);
  });
});
