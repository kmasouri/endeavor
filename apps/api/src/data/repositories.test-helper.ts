import {
  AgentRepository,
  ApprovalRepository,
  CatalogRepository,
  ConversationRepository,
  DocumentRepository,
  HumanRepository,
  MessageRepository,
  NoteRepository,
  ResponsibilityRepository,
  TaskCapabilityRepository,
  TaskRepository
} from '.';

// Jest mocks of every repository, for service tests. Each method is a bare jest.fn(); tests set
// the return values they need.

export function mockTaskRepository(): jest.Mocked<TaskRepository> {
  return {
    create: jest.fn(),
    getById: jest.fn(),
    getByRunKey: jest.fn(),
    list: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    addWaits: jest.fn(),
    listWaits: jest.fn().mockResolvedValue([]),
    findOpenWaits: jest.fn().mockResolvedValue([]),
    resolveWait: jest.fn(),
    resolveOpenWaits: jest.fn().mockResolvedValue(0),
    addEvent: jest.fn(),
    recordToolResults: jest.fn().mockResolvedValue(true),
    listLatestEvents: jest.fn().mockResolvedValue([]),
    listEvents: jest.fn().mockResolvedValue([]),
    addOutput: jest.fn(),
    listOutputs: jest.fn().mockResolvedValue([]),
    countOutputs: jest.fn().mockResolvedValue(0),
    listConversationOutputs: jest.fn().mockResolvedValue([]),
    countConversationOutputs: jest.fn().mockResolvedValue(0),
    sumCost: jest.fn().mockResolvedValue({ costUsd: 0, tokens: 0, unpricedCalls: 0 }),
    listTaskCosts: jest.fn().mockResolvedValue([]),
    claimRunnable: jest.fn().mockResolvedValue([]),
    releaseLease: jest.fn(),
    renewLease: jest.fn().mockResolvedValue(true),
    findOpenTask: jest.fn().mockResolvedValue(null),
    findOpenRun: jest.fn().mockResolvedValue(null),
    listWaitingWithoutOpenWaits: jest.fn().mockResolvedValue([]),
    listFinishedWithoutEvent: jest.fn().mockResolvedValue([]),
    countEvents: jest.fn().mockResolvedValue(0)
  };
}

export function mockAgentRepository(): jest.Mocked<AgentRepository> {
  return {
    create: jest.fn(),
    getById: jest.fn(),
    getByName: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    listDirectory: jest.fn().mockResolvedValue([]),
    countDirectory: jest.fn().mockResolvedValue(0),
    update: jest.fn(),
    setDisabled: jest.fn(),
    getDeletionImpact: jest.fn().mockResolvedValue({ tasks: [], schedules: [] }),
    delete: jest.fn().mockResolvedValue(true),
    acquireExecution: jest.fn().mockImplementation(async () => async () => {}),
    addVersion: jest.fn(),
    getVersion: jest.fn(),
    getVersions: jest.fn().mockResolvedValue([]),
    listVersions: jest.fn().mockResolvedValue([])
  };
}

export function mockHumanRepository(): jest.Mocked<HumanRepository> {
  return {
    update: jest.fn(),
    create: jest.fn(),
    createFirst: jest.fn(),
    getById: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0)
  };
}

export function mockConversationRepository(): jest.Mocked<ConversationRepository> {
  return {
    create: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    addMember: jest.fn(),
    listMembers: jest.fn().mockResolvedValue([]),
    getMember: jest.fn().mockResolvedValue(null),
    markRead: jest.fn(),
    countUnread: jest.fn().mockResolvedValue(new Map())
  };
}

export function mockMessageRepository(): jest.Mocked<MessageRepository> {
  return {
    create: jest.fn(),
    getById: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
    listRecent: jest.fn().mockResolvedValue([]),
    claimDeliveries: jest.fn().mockResolvedValue([]),
    markDelivered: jest.fn(),
    recordDeliveryFailure: jest.fn()
  };
}

export function mockCatalogRepository(): jest.Mocked<CatalogRepository> {
  return {
    createSkill: jest.fn(),
    getSkill: jest.fn().mockResolvedValue(null),
    getSkills: jest.fn().mockResolvedValue([]),
    listSkills: jest.fn().mockResolvedValue([]),
    countSkills: jest.fn().mockResolvedValue(0),
    addSkillVersion: jest.fn(),
    getSkillVersions: jest.fn().mockResolvedValue([]),
    listSkillVersions: jest.fn().mockResolvedValue([]),
    setSkillDisabled: jest.fn(),
    setSkillDiscoverable: jest.fn(),
    listDiscoverable: jest.fn().mockResolvedValue({ skills: [], connections: [] }),
    createConnection: jest.fn(),
    getConnection: jest.fn().mockResolvedValue(null),
    getConnections: jest.fn().mockResolvedValue([]),
    listConnections: jest.fn().mockResolvedValue([]),
    countConnections: jest.fn().mockResolvedValue(0),
    updateConnection: jest.fn(),
    setConnectionDisabled: jest.fn(),
    getConnectionCredential: jest.fn().mockResolvedValue(null),
    grant: jest.fn(),
    revoke: jest.fn().mockResolvedValue(true),
    listGrants: jest.fn().mockResolvedValue([])
  };
}

export function mockApprovalRepository(): jest.Mocked<ApprovalRepository> {
  return {
    getByClientKey: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    getById: jest.fn().mockResolvedValue(null),
    listForTask: jest.fn().mockResolvedValue([]),
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    decide: jest.fn().mockResolvedValue(null),
    listApprovedNotExecuted: jest.fn().mockResolvedValue([]),
    listExecutedAwaitingWake: jest.fn().mockResolvedValue([]),
    markExecuted: jest.fn().mockResolvedValue(true),
    saveResult: jest.fn()
  };
}

export function mockTaskCapabilityRepository(): jest.Mocked<TaskCapabilityRepository> {
  return {
    add: jest.fn(),
    getById: jest.fn().mockResolvedValue(null),
    listForTask: jest.fn().mockResolvedValue([]),
    revoke: jest.fn().mockResolvedValue(null)
  };
}

export function mockNoteRepository(): jest.Mocked<NoteRepository> {
  return {
    create: jest.fn(),
    getById: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn(),
    softDelete: jest.fn().mockResolvedValue(true)
  };
}

export function mockDocumentRepository(): jest.Mocked<DocumentRepository> {
  return {
    add: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(true)
  };
}

export function mockResponsibilityRepository(): jest.Mocked<ResponsibilityRepository> {
  return {
    create: jest.fn(),
    getById: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn(),
    listDue: jest.fn().mockResolvedValue([]),
    advance: jest.fn().mockResolvedValue(true),
    clearCatchUp: jest.fn().mockResolvedValue(true)
  };
}
