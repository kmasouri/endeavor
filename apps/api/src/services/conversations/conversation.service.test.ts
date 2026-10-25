import {
  mockAgentRepository,
  mockConversationRepository,
  mockHumanRepository,
  mockMessageRepository,
  mockDocumentRepository
} from '../../data/repositories.test-helper';
import { ConversationLogger } from '../../observability';
import { Agent, Conversation, ConversationMember, Human, Message } from '../../shared/types';
import { ConversationService } from './conversation.service';

const CONV = '00000000-0000-4000-8000-0000000000f1';
const KIM = '00000000-0000-4000-8000-000000000001';
const LEE = '00000000-0000-4000-8000-000000000002';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const OTHER_AGENT = '00000000-0000-4000-8000-0000000000a2';

const kim: Human = {
  id: KIM,
  name: 'Kim',
  role: 'member',
  preferences: { theme: 'system', timeFormat: '12h' },
  createdAt: new Date()
};
const conversation: Conversation = {
  id: CONV,
  title: 'Billing',
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
    onDocumentAdded: jest.fn()
  } as unknown as jest.Mocked<ConversationLogger>;
  const notes = mockDocumentRepository();
  const service = new ConversationService(conversations, messages, agents, humans, notes, logger);
  return { service, conversations, messages, agents, humans, notes };
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

  it('persists canonical names on create and rename', async () => {
    const { service, conversations } = setup();
    await service.createConversation(KIM, { title: '  Heat Pumps!! Brief  ' });
    expect(conversations.create).toHaveBeenCalledWith({
      title: 'heat-pumps-brief',
      createdByHumanId: KIM
    });
    await service.updateConversation(KIM, CONV, { title: '#New Goal!', budgetUsd: 10 });
    expect(conversations.update).toHaveBeenCalledWith(CONV, { title: 'new-goal', budgetUsd: 10 });
    await service.updateConversation(KIM, CONV, { budgetUsd: 20 });
    expect(conversations.update).toHaveBeenLastCalledWith(CONV, { budgetUsd: 20 });
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
    notes.get.mockResolvedValue({ id: 'd1', conversationId: 'elsewhere' } as never);

    await expect(service.deleteDocument(KIM, CONV, 'd1')).rejects.toMatchObject({
      name: 'documentNotFound'
    });
    expect(notes.delete).not.toHaveBeenCalled();
  });
});
