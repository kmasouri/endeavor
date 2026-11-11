import {
  mockAgentRepository,
  mockConversationRepository,
  mockHumanRepository,
  mockMessageRepository,
  mockDocumentRepository,
  mockProjectRepository
} from '../../data/repositories.test-helper';
import { ConversationLogger } from '../../observability';
import {
  Agent,
  Conversation,
  ConversationMember,
  Human,
  Message,
  Project
} from '../../shared/types';
import { ConversationService } from './conversation.service';

const CONV = '00000000-0000-4000-8000-0000000000f1';
const KIM = '00000000-0000-4000-8000-000000000001';
const LEE = '00000000-0000-4000-8000-000000000002';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const OTHER_AGENT = '00000000-0000-4000-8000-0000000000a2';
const PROJECT = '00000000-0000-4000-8000-0000000000e1';

const kim: Human = {
  id: KIM,
  name: 'Kim',
  role: 'member',
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
};
const project: Project = {
  id: PROJECT,
  name: 'General',
  about: null,
  isDefault: true,
  createdByHumanId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  archivedAt: null
};
const conversation: Conversation = {
  id: CONV,
  title: 'Billing',
  projectId: PROJECT,
  goal: null,
  goalMessageId: null,
  doneCriteria: null,
  state: 'open',
  closedAt: null,
  closedByHumanId: null,
  createdByHumanId: KIM,
  budgetUsd: null,
  createdAt: new Date()
};
const agent: Agent = {
  id: AGENT,
  name: 'Researcher',
  purpose: 'Research',
  currentVersionId: 'v1',
  disabledAt: null,
  monthlyBudgetUsd: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function member(type: 'human' | 'agent', id: string): ConversationMember {
  return {
    conversationId: CONV,
    participant: { type, id },
    addedByHumanId: KIM,
    historyFrom: null,
    addedAt: new Date()
  };
}

function setup() {
  const conversations = mockConversationRepository();
  const messages = mockMessageRepository();
  const agents = mockAgentRepository();
  const humans = mockHumanRepository();
  humans.getById.mockImplementation(async (id) => (id === KIM ? kim : null));
  agents.getById.mockImplementation(async (id) => (id === AGENT ? agent : null));
  conversations.create.mockResolvedValue(conversation);
  conversations.getById.mockResolvedValue(conversation);
  conversations.getMember.mockImplementation(async (_conv, ref) =>
    ref.id === KIM ? member('human', KIM) : null
  );
  conversations.listMembers.mockResolvedValue([member('human', KIM), member('agent', AGENT)]);
  messages.create.mockImplementation(async (input) => ({
    message: { id: 'm1', createdAt: new Date(), ...input } as unknown as Message,
    created: true
  }));
  const logger = {
    onConversationCreated: jest.fn(),
    onMemberAdded: jest.fn(),
    onMessagePosted: jest.fn(),
    onDocumentAdded: jest.fn(),
    onGoalSet: jest.fn(),
    onConversationClosed: jest.fn(),
    onConversationReopened: jest.fn()
  } as unknown as jest.Mocked<ConversationLogger>;
  const notes = mockDocumentRepository();
  const projects = mockProjectRepository();
  projects.getDefault.mockResolvedValue(project);
  projects.getById.mockImplementation(async (id) => (id === PROJECT ? project : null));
  const service = new ConversationService(
    conversations,
    messages,
    agents,
    humans,
    notes,
    projects,
    logger
  );
  return { service, conversations, messages, agents, humans, notes, projects, logger };
}

describe('ConversationService', () => {
  it('retains deleted-agent membership for attribution while flagging it unavailable for mentions', async () => {
    const { service, agents } = setup();
    agents.getById.mockResolvedValue({
      ...agent,
      name: 'Deleted agent',
      deletedAt: new Date(),
      disabledAt: new Date(),
      currentVersionId: null
    });
    const details = await service.getConversation(KIM, CONV);
    expect(details.members.find((m) => m.participant.id === AGENT)).toMatchObject({
      name: 'Deleted agent',
      deleted: true
    });
  });

  it('rejects oversized creates and renames before writing', async () => {
    const { service, conversations } = setup();
    await expect(service.createConversation(KIM, { title: 'a'.repeat(65) })).rejects.toMatchObject({
      name: 'validationError'
    });
    await expect(
      service.updateConversation(KIM, CONV, { title: 'a'.repeat(65) })
    ).rejects.toMatchObject({ name: 'validationError' });
    expect(conversations.create).not.toHaveBeenCalled();
    expect(conversations.update).not.toHaveBeenCalled();
  });

  it('persists canonical names on create and rename', async () => {
    const { service, conversations } = setup();
    await service.createConversation(KIM, { title: '  Heat Pumps!! Brief  ' });
    expect(conversations.create).toHaveBeenCalledWith({
      title: 'heat-pumps-brief',
      projectId: PROJECT,
      goal: null,
      doneCriteria: null,
      createdByHumanId: KIM
    });
    await service.updateConversation(KIM, CONV, { title: '#New Goal!', budgetUsd: 10 });
    expect(conversations.update).toHaveBeenCalledWith(CONV, {
      title: 'new-goal',
      budgetUsd: 10,
      doneCriteria: undefined
    });
    await service.updateConversation(KIM, CONV, { budgetUsd: 20 });
    expect(conversations.update).toHaveBeenLastCalledWith(CONV, {
      budgetUsd: 20,
      doneCriteria: undefined
    });
  });

  it('adds the creator and the chosen agents as members', async () => {
    const { service, conversations } = setup();

    await service.createConversation(KIM, { title: 'Billing', agentIds: [AGENT] });

    expect(conversations.addMember.mock.calls.map(([input]) => input.participant)).toEqual([
      { type: 'human', id: KIM },
      { type: 'agent', id: AGENT }
    ]);
  });

  it('refuses an unknown agent before creating anything', async () => {
    const { service, conversations } = setup();

    await expect(
      service.createConversation(KIM, { title: 'Billing', agentIds: [OTHER_AGENT] })
    ).rejects.toMatchObject({ name: 'participantNotFound' });
    expect(conversations.create).not.toHaveBeenCalled();
  });

  it('adds chosen people and agents once without posting a message or starting work', async () => {
    const { service, conversations, humans, messages } = setup();
    humans.getById.mockImplementation(async (id) =>
      id === KIM ? kim : id === LEE ? { ...kim, id: LEE, name: 'Lee' } : null
    );
    await service.createConversation(KIM, {
      title: 'Billing',
      humanIds: [KIM, LEE, LEE],
      agentIds: [AGENT, AGENT]
    });
    expect(conversations.addMember.mock.calls.map(([input]) => input.participant)).toEqual([
      { type: 'human', id: KIM },
      { type: 'human', id: LEE },
      { type: 'agent', id: AGENT }
    ]);
    expect(messages.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown person before creating anything', async () => {
    const { service, conversations } = setup();
    await expect(
      service.createConversation(KIM, { title: 'Billing', humanIds: [LEE] })
    ).rejects.toMatchObject({ name: 'participantNotFound' });
    expect(conversations.create).not.toHaveBeenCalled();
    expect(conversations.addMember).not.toHaveBeenCalled();
  });

  it('delivers a message only to the agents it addresses', async () => {
    const { service, messages } = setup();

    await service.postMessage(KIM, CONV, {
      body: 'Please summarize',
      mentions: [{ type: 'agent', id: AGENT }]
    });

    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ authorType: 'human', authorId: KIM, deliverToAgentIds: [AGENT] })
    );
  });

  it('saves a message that mentions nobody without delivering it', async () => {
    const { service, messages } = setup();

    await service.postMessage(KIM, CONV, { body: 'Thinking out loud' });

    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ deliverToAgentIds: [] })
    );
  });

  it('delivers a reply to the agent who wrote the message', async () => {
    const { service, messages } = setup();
    messages.getById.mockResolvedValue({
      id: 'm0',
      conversationId: CONV,
      authorType: 'agent',
      authorId: AGENT
    } as Message);

    await service.postMessage(KIM, CONV, { body: 'v2, please', inReplyToMessageId: 'm0' });

    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ deliverToAgentIds: [AGENT], inReplyToMessageId: 'm0' })
    );
  });

  it('rejects mentions of non-members', async () => {
    const { service, messages } = setup();

    await expect(
      service.postMessage(KIM, CONV, {
        body: 'Hi',
        mentions: [{ type: 'agent', id: OTHER_AGENT }]
      })
    ).rejects.toMatchObject({ name: 'mentionNotMember' });
    expect(messages.create).not.toHaveBeenCalled();
  });

  it('rejects a reply to a message from another conversation', async () => {
    const { service, messages } = setup();
    messages.getById.mockResolvedValue({ id: 'm0', conversationId: 'elsewhere' } as Message);

    await expect(
      service.postMessage(KIM, CONV, { body: 'Hi', inReplyToMessageId: 'm0' })
    ).rejects.toMatchObject({ name: 'messageNotFound' });
  });

  it('only lets members post, even admins', async () => {
    const { service, humans } = setup();
    humans.getById.mockResolvedValue({
      id: LEE,
      name: 'Lee',
      role: 'admin',
      preferences: { theme: 'system', timeFormat: '12h' },
      createdAt: new Date()
    });

    await expect(service.postMessage(LEE, CONV, { body: 'Hi' })).rejects.toMatchObject({
      name: 'notConversationMember'
    });
  });

  it('lets an admin read a conversation they are not in', async () => {
    const { service, humans } = setup();
    humans.getById.mockResolvedValue({
      id: LEE,
      name: 'Lee',
      role: 'admin',
      preferences: { theme: 'system', timeFormat: '12h' },
      createdAt: new Date()
    });

    await expect(service.listMessages(LEE, CONV, { limit: 10, offset: 0 })).resolves.toEqual([]);
  });

  it('hides history from before a member joined when added "from now"', async () => {
    const { service, conversations, messages } = setup();
    const joined = new Date('2026-10-01T00:00:00Z');
    conversations.getMember.mockResolvedValue({ ...member('human', KIM), historyFrom: joined });

    await service.listMessages(KIM, CONV, { limit: 10, offset: 0 });

    expect(messages.list).toHaveBeenCalledWith(CONV, { since: joined, limit: 10, offset: 0 });
  });

  it.each(['beforeId', 'afterId'] as const)(
    'keeps history visibility for %s windows',
    async (direction) => {
      const { service, conversations, messages } = setup();
      const joined = new Date('2026-10-01T00:00:00Z');
      conversations.getMember.mockResolvedValue({ ...member('human', KIM), historyFrom: joined });
      messages.getById.mockResolvedValue({
        id: 'cursor',
        conversationId: CONV,
        createdAt: joined
      } as Message);
      await service.listMessages(KIM, CONV, { limit: 50, offset: 0, [direction]: 'cursor' });
      expect(messages.listWindow).toHaveBeenCalledWith(
        CONV,
        expect.objectContaining({ since: joined, limit: 50, [direction]: 'cursor' })
      );
      expect(messages.list).not.toHaveBeenCalled();
      messages.getById.mockResolvedValue({
        id: 'cursor',
        conversationId: CONV,
        createdAt: new Date('2026-09-30')
      } as Message);
      await expect(
        service.listMessages(KIM, CONV, { limit: 50, offset: 0, [direction]: 'cursor' })
      ).rejects.toMatchObject({ name: 'messageNotFound' });
    }
  );
  it('rejects a cursor from a different conversation', async () => {
    const { service, messages } = setup();
    messages.getById.mockResolvedValue({ id: 'cursor', conversationId: 'elsewhere' } as Message);
    await expect(
      service.listMessages(KIM, CONV, { limit: 50, offset: 0, afterId: 'cursor' })
    ).rejects.toMatchObject({ name: 'messageNotFound' });
    expect(messages.listWindow).not.toHaveBeenCalled();
  });

  it('records who added a member and from when they can read', async () => {
    const { service, conversations } = setup();

    await service.addMember(KIM, CONV, {
      participant: { type: 'agent', id: AGENT },
      history: 'from_now'
    });

    expect(conversations.addMember).toHaveBeenCalledWith(
      expect.objectContaining({ addedByHumanId: KIM, historyFrom: expect.any(Date) })
    );
  });

  it('lets members attach documents, but not outsiders', async () => {
    const { service, notes, humans } = setup();
    notes.add.mockResolvedValue({ id: 'd1' } as never);

    await service.addDocument(KIM, CONV, { title: 'Policy', content: 'Text' });
    expect(notes.add).toHaveBeenCalledWith({
      projectId: PROJECT,
      conversationId: CONV,
      title: 'Policy',
      content: 'Text',
      addedByHumanId: KIM
    });

    humans.getById.mockResolvedValue({
      id: LEE,
      name: 'Lee',
      role: 'member',
      preferences: { theme: 'system', timeFormat: '12h' },
      createdAt: new Date()
    });
    await expect(
      service.addDocument(LEE, CONV, { title: 'x', content: 'y' })
    ).rejects.toMatchObject({ name: 'notConversationMember' });
  });

  it("won't delete a document from another conversation", async () => {
    const { service, notes } = setup();
    notes.get.mockResolvedValue({
      id: 'd1',
      projectId: PROJECT,
      conversationId: 'elsewhere'
    } as never);

    await expect(service.deleteDocument(KIM, CONV, 'd1')).rejects.toMatchObject({
      name: 'documentNotFound'
    });
    expect(notes.delete).not.toHaveBeenCalled();
  });

  it('returns an unread count for each listed conversation, 0 when there is none', async () => {
    const { service, conversations } = setup();
    const other = { ...conversation, id: 'c2' };
    conversations.list.mockResolvedValue([conversation, other]);
    conversations.count.mockResolvedValue(2);
    conversations.countUnread.mockResolvedValue(new Map([[CONV, 3]]));

    const result = await service.listConversations(KIM, { limit: 50, offset: 0 });

    expect(conversations.countUnread).toHaveBeenCalledWith({
      humanId: KIM,
      conversationIds: [CONV, 'c2']
    });
    expect(result.conversations.map((item) => item.unreadCount)).toEqual([3, 0]);
    expect(result.total).toBe(2);
  });

  it('marks a conversation read up to a message and returns what is left unread', async () => {
    const { service, conversations, messages } = setup();
    messages.getById.mockResolvedValue({ id: 'm1', conversationId: CONV } as Message);
    conversations.countUnread.mockResolvedValue(new Map());

    const result = await service.markRead(KIM, CONV, { messageId: 'm1' });

    expect(conversations.markRead).toHaveBeenCalledWith({
      conversationId: CONV,
      humanId: KIM,
      messageId: 'm1'
    });
    expect(result).toEqual({ conversationId: CONV, unreadCount: 0 });
  });

  it("won't mark read with a message from another conversation", async () => {
    const { service, conversations, messages } = setup();
    messages.getById.mockResolvedValue({ id: 'm1', conversationId: 'elsewhere' } as Message);

    await expect(service.markRead(KIM, CONV, { messageId: 'm1' })).rejects.toMatchObject({
      name: 'messageNotFound'
    });
    expect(conversations.markRead).not.toHaveBeenCalled();
  });

  it("won't mark read with a message that doesn't exist", async () => {
    const { service, conversations, messages } = setup();
    messages.getById.mockResolvedValue(null);

    await expect(service.markRead(KIM, CONV, { messageId: 'm1' })).rejects.toMatchObject({
      name: 'messageNotFound'
    });
    expect(conversations.markRead).not.toHaveBeenCalled();
  });
});

it('returns saved agent appearance on conversation members', async () => {
  const { service, agents, conversations } = setup();
  agents.getById.mockResolvedValue({ ...agent, avatarColor: 'teal', avatarIcon: 'file' });
  conversations.listMembers.mockResolvedValue([member('human', KIM), member('agent', AGENT)]);
  const details = await service.getConversation(KIM, CONV);
  expect(details.members.find((m) => m.participant.id === AGENT)).toMatchObject({
    avatarColor: 'teal',
    avatarIcon: 'file'
  });
  expect(details.members.find((m) => m.participant.id === KIM)).not.toHaveProperty('avatarIcon');
});

describe('ConversationService projects and goals', () => {
  it('starts an endeavor in a named project with its goal and filled-in done criteria', async () => {
    const { service, conversations } = setup();

    await service.createConversation(KIM, {
      title: 'Refunds',
      projectId: PROJECT,
      goal: 'Summarize the  refund\npolicy'
    });

    expect(conversations.create).toHaveBeenCalledWith({
      title: 'refunds',
      projectId: PROJECT,
      goal: 'Summarize the  refund\npolicy',
      doneCriteria:
        'Done when the result meets this request and a person confirms it: Summarize the refund policy',
      createdByHumanId: KIM
    });
  });

  it('keeps an explicitly standalone endeavor separate from project defaults', async () => {
    const { service, conversations, projects } = setup();
    await service.createConversation(KIM, { title: 'Solo request', projectId: null });
    expect(projects.getDefault).not.toHaveBeenCalled();
    expect(projects.listMembers).not.toHaveBeenCalled();
    expect(conversations.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }));
  });

  it('keeps done criteria a person wrote', async () => {
    const { service, conversations } = setup();

    await service.createConversation(KIM, {
      title: 'Refunds',
      goal: 'Summarize the refund policy',
      doneCriteria: 'A one-page summary'
    });

    expect(conversations.create).toHaveBeenCalledWith(
      expect.objectContaining({ doneCriteria: 'A one-page summary' })
    );
  });

  it("refuses a project that doesn't exist or is archived", async () => {
    const { service, conversations, projects } = setup();

    await expect(
      service.createConversation(KIM, { title: 'Refunds', projectId: OTHER_AGENT })
    ).rejects.toMatchObject({ name: 'projectNotFound' });
    projects.getDefault.mockResolvedValue({ ...project, archivedAt: new Date() });
    await expect(service.createConversation(KIM, { title: 'Refunds' })).rejects.toMatchObject({
      name: 'projectArchived'
    });
    expect(conversations.create).not.toHaveBeenCalled();
  });

  it("adds the project's default members, skipping ones that can't join", async () => {
    const { service, conversations, projects } = setup();
    projects.listMembers.mockResolvedValue([
      {
        projectId: PROJECT,
        participant: { type: 'human', id: KIM },
        addedByHumanId: KIM,
        addedAt: new Date()
      },
      {
        projectId: PROJECT,
        participant: { type: 'agent', id: AGENT },
        addedByHumanId: KIM,
        addedAt: new Date()
      },
      {
        projectId: PROJECT,
        participant: { type: 'agent', id: OTHER_AGENT },
        addedByHumanId: KIM,
        addedAt: new Date()
      }
    ]);

    await service.createConversation(KIM, { title: 'Billing' });

    expect(conversations.addMember.mock.calls.map(([input]) => input.participant)).toEqual([
      { type: 'human', id: KIM },
      { type: 'agent', id: AGENT }
    ]);
  });

  it("makes a person's first message the goal", async () => {
    const { service, conversations, logger } = setup();
    conversations.setGoalIfEmpty.mockResolvedValue({ ...conversation, goal: 'Check refunds' });

    await service.postMessage(KIM, CONV, { body: 'Check refunds' });

    expect(conversations.setGoalIfEmpty).toHaveBeenCalledWith(CONV, {
      goal: 'Check refunds',
      goalMessageId: 'm1',
      doneCriteria:
        'Done when the result meets this request and a person confirms it: Check refunds'
    });
    expect(logger.onGoalSet).toHaveBeenCalledWith(CONV, 'm1');
  });

  it('leaves an existing goal alone', async () => {
    const { service, conversations } = setup();
    conversations.getById.mockResolvedValue({ ...conversation, goal: 'Earlier request' });

    await service.postMessage(KIM, CONV, { body: 'One more thing' });

    expect(conversations.setGoalIfEmpty).not.toHaveBeenCalled();
  });

  it('fills in done criteria when a goal is set on an endeavor without them', async () => {
    const { service, conversations } = setup();

    await service.updateConversation(KIM, CONV, { goal: 'Check refunds' });

    expect(conversations.update).toHaveBeenCalledWith(CONV, {
      goal: 'Check refunds',
      doneCriteria:
        'Done when the result meets this request and a person confirms it: Check refunds'
    });
  });

  it('closes an endeavor once, and reopens it', async () => {
    const { service, conversations, logger } = setup();
    const closed = { ...conversation, state: 'closed' as const, closedAt: new Date() };
    conversations.setClosed.mockResolvedValue(closed);

    expect((await service.closeConversation(KIM, CONV)).state).toBe('closed');
    expect(conversations.setClosed).toHaveBeenCalledWith(CONV, KIM);
    expect(logger.onConversationClosed).toHaveBeenCalledWith(CONV, KIM);

    conversations.getById.mockResolvedValue(closed);
    await service.closeConversation(KIM, CONV);
    expect(conversations.setClosed).toHaveBeenCalledTimes(1);

    conversations.setClosed.mockResolvedValue(conversation);
    expect((await service.reopenConversation(KIM, CONV)).state).toBe('open');
    expect(conversations.setClosed).toHaveBeenLastCalledWith(CONV, null);
    expect(logger.onConversationReopened).toHaveBeenCalledWith(CONV, KIM);
  });

  it('takes no messages while closed', async () => {
    const { service, conversations, messages } = setup();
    conversations.getById.mockResolvedValue({ ...conversation, state: 'closed' });

    await expect(service.postMessage(KIM, CONV, { body: 'Hello' })).rejects.toMatchObject({
      name: 'conversationClosed'
    });
    expect(messages.create).not.toHaveBeenCalled();
  });

  it('lists open endeavors unless asked, optionally for one project', async () => {
    const { service, conversations } = setup();

    await service.listConversations(KIM, { limit: 10, offset: 0 });
    expect(conversations.count).toHaveBeenLastCalledWith({
      participant: null,
      projectId: null,
      state: 'open'
    });

    await service.listConversations(KIM, {
      limit: 10,
      offset: 0,
      projectId: PROJECT,
      state: 'all'
    });
    expect(conversations.list).toHaveBeenLastCalledWith({
      participant: null,
      projectId: PROJECT,
      state: 'all',
      limit: 10,
      offset: 0
    });
  });

  it("lists the project's shared documents with this endeavor's own", async () => {
    const { service, notes } = setup();

    await service.listDocuments(KIM, CONV);

    expect(notes.list).toHaveBeenCalledWith({ conversationId: CONV });
  });

  it("deletes a project's shared document from any of its endeavors", async () => {
    const { service, notes } = setup();
    notes.get.mockResolvedValue({ id: 'd1', projectId: PROJECT, conversationId: null } as never);

    await service.deleteDocument(KIM, CONV, 'd1');

    expect(notes.delete).toHaveBeenCalledWith('d1');
  });
});

it('returns only public handoff fields and endeavor status on agent members', async () => {
  const { service, agents } = setup();
  agents.getProfiles.mockResolvedValue([
    {
      id: AGENT,
      name: 'Researcher',
      purpose: 'Research',
      produces: 'Sourced brief',
      needs: 'A question',
      skillNames: ['Research'],
      status: 'busy'
    }
  ]);
  const details = await service.getConversation(KIM, CONV);
  expect(agents.getProfiles).toHaveBeenCalledWith([AGENT], CONV);
  expect(details.members.find((member) => member.participant.id === AGENT)).toEqual(
    expect.objectContaining({
      produces: 'Sourced brief',
      needs: 'A question',
      skillNames: ['Research'],
      status: 'busy'
    })
  );
  const profile = details.members.find((member) => member.participant.id === AGENT)!;
  expect(Object.keys(profile).sort()).toEqual(
    [
      'addedAt',
      'addedByHumanId',
      'avatarColor',
      'avatarIcon',
      'conversationId',
      'deleted',
      'historyFrom',
      'name',
      'needs',
      'participant',
      'produces',
      'purpose',
      'skillNames',
      'status'
    ].sort()
  );
  expect(details.members.find((member) => member.participant.type === 'human')).not.toHaveProperty(
    'status'
  );
});
