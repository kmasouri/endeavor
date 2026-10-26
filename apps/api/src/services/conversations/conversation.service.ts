import {
  AgentRepository,
  ConversationRepository,
  HumanRepository,
  DocumentRepository,
  MessageRepository
} from '../../data';
import { ConversationLogger } from '../../observability';
import { requireHuman, hasFullAccess } from '../../shared/access';
import { addressedAgentIds } from '../../shared/addressing';
import { canonicalConversationName } from '../../shared/conversation-name';
import { AppError } from '../../shared/errors';
import {
  Conversation,
  ConversationDocument,
  ConversationMember,
  Human,
  Message,
  ParticipantRef
} from '../../shared/types';

export interface MemberDetails extends ConversationMember {
  deleted?: boolean;
  name: string;
  // An agent's purpose, so participants know whom to ask. null for humans.
  purpose: string | null;
}

export interface ConversationDetails extends Conversation {
  members: MemberDetails[];
}

export interface ConversationSummary extends Conversation {
  // Messages from others the acting person hasn't seen. Always 0 where they aren't a member.
  unreadCount: number;
}

// Shared conversations between humans and agents. Humans post here through the API; agents
// post through the runner. Posting a message only saves it and records which agents it is
// addressed to. The runner turns those into work.
export class ConversationService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly conversationLogger: ConversationLogger
  ) {}

  async createConversation(
    actorId: string,
    input: { title: string; agentIds?: string[]; humanIds?: string[] }
  ): Promise<ConversationDetails> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const humanIds = [...new Set(input.humanIds ?? [])].filter((id) => id !== human.id);
    const agentIds = [...new Set(input.agentIds ?? [])];
    for (const humanId of humanIds) {
      await this.requireParticipant({ type: 'human', id: humanId });
    }
    for (const agentId of agentIds) {
      await this.requireParticipant({ type: 'agent', id: agentId });
    }

    const conversation = await this.conversationRepository.create({
      title: canonicalConversationName(input.title),
      createdByHumanId: human.id
    });
    await this.conversationRepository.addMember({
      conversationId: conversation.id,
      participant: { type: 'human', id: human.id },
      addedByHumanId: human.id,
      historyFrom: null
    });
    for (const humanId of humanIds) {
      await this.conversationRepository.addMember({
        conversationId: conversation.id,
        participant: { type: 'human', id: humanId },
        addedByHumanId: human.id,
        historyFrom: null
      });
    }
    for (const agentId of agentIds) {
      await this.conversationRepository.addMember({
        conversationId: conversation.id,
        participant: { type: 'agent', id: agentId },
        addedByHumanId: human.id,
        historyFrom: null
      });
    }
    this.conversationLogger.onConversationCreated(conversation.id);
    return this.loadDetails(conversation);
  }

  // Admins see every conversation. Members see the ones they belong to.
  async listConversations(
    actorId: string,
    input: { limit: number; offset: number }
  ): Promise<{ conversations: ConversationSummary[]; total: number }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const participant: ParticipantRef | null = hasFullAccess(human)
      ? null
      : { type: 'human', id: human.id };
    const [conversations, total] = await Promise.all([
      this.conversationRepository.list({ participant, ...input }),
      this.conversationRepository.count({ participant })
    ]);
    const unread = await this.conversationRepository.countUnread({
      humanId: human.id,
      conversationIds: conversations.map((conversation) => conversation.id)
    });
    return {
      conversations: conversations.map((conversation) => ({
        ...conversation,
        unreadCount: unread.get(conversation.id) ?? 0
      })),
      total
    };
  }

  // Opening a conversation marks it read up to the newest message shown. Reading an older
  // message again never makes newer ones unread.
  async markRead(
    actorId: string,
    conversationId: string,
    input: { messageId: string }
  ): Promise<{ conversationId: string; unreadCount: number }> {
    const { conversation, human } = await this.requireAccess(actorId, conversationId);
    const message = await this.messageRepository.getById(input.messageId);
    if (!message || message.conversationId !== conversation.id) {
      throw new AppError('messageNotFound', `Message ${input.messageId} was not found`);
    }
    await this.conversationRepository.markRead({
      conversationId: conversation.id,
      humanId: human.id,
      messageId: message.id
    });
    const unread = await this.conversationRepository.countUnread({
      humanId: human.id,
      conversationIds: [conversation.id]
    });
    return { conversationId: conversation.id, unreadCount: unread.get(conversation.id) ?? 0 };
  }

  async updateConversation(
    actorId: string,
    conversationId: string,
    changes: { title?: string; budgetUsd?: number | null }
  ): Promise<ConversationDetails> {
    const { conversation } = await this.requireAccess(actorId, conversationId);
    const updated = await this.conversationRepository.update(conversation.id, {
      ...changes,
      ...(changes.title !== undefined && { title: canonicalConversationName(changes.title) })
    });
    return this.loadDetails(updated ?? conversation);
  }

  async getConversation(actorId: string, conversationId: string): Promise<ConversationDetails> {
    const { conversation } = await this.requireAccess(actorId, conversationId);
    return this.loadDetails(conversation);
  }

  // Only humans add members. An agent can suggest a specialist, but a person adds it.
  async addMember(
    actorId: string,
    conversationId: string,
    input: { participant: ParticipantRef; history: 'all' | 'from_now' }
  ): Promise<ConversationDetails> {
    const { conversation, human } = await this.requireAccess(actorId, conversationId);
    await this.requireParticipant(input.participant);

    await this.conversationRepository.addMember({
      conversationId: conversation.id,
      participant: input.participant,
      addedByHumanId: human.id,
      historyFrom: input.history === 'from_now' ? new Date() : null
    });
    this.conversationLogger.onMemberAdded(
      conversation.id,
      input.participant.type,
      input.participant.id
    );
    return this.loadDetails(conversation);
  }

  async postMessage(
    actorId: string,
    conversationId: string,
    input: {
      body: string;
      mentions?: ParticipantRef[];
      inReplyToMessageId?: string;
      clientKey?: string;
    }
  ): Promise<{ message: Message; created: boolean }> {
    const { conversation, human } = await this.requireAccess(actorId, conversationId, {
      memberOnly: true
    });
    const members = await this.conversationRepository.listMembers(conversation.id);
    const mentions = input.mentions ?? [];
    for (const mention of mentions) {
      if (!members.some((member) => isSameParticipant(member.participant, mention))) {
        throw new AppError('mentionNotMember', `${mention.type} ${mention.id} is not a member`);
      }
    }

    let repliedToAuthor: ParticipantRef | null = null;
    if (input.inReplyToMessageId) {
      const repliedTo = await this.messageRepository.getById(input.inReplyToMessageId);
      if (!repliedTo || repliedTo.conversationId !== conversation.id) {
        throw new AppError('messageNotFound', `Message ${input.inReplyToMessageId} was not found`);
      }
      repliedToAuthor =
        repliedTo.authorType === 'agent' && repliedTo.authorId
          ? { type: 'agent', id: repliedTo.authorId }
          : null;
    }

    const deliverToAgentIds = addressedAgentIds({
      mentions,
      repliedToAuthor,
      memberAgentIds: new Set(
        members
          .filter((member) => member.participant.type === 'agent')
          .map((member) => member.participant.id)
      ),
      authorAgentId: null
    });
    const result = await this.messageRepository.create({
      conversationId: conversation.id,
      authorType: 'human',
      authorId: human.id,
      body: input.body,
      mentions,
      inReplyToMessageId: input.inReplyToMessageId ?? null,
      taskId: null,
      deliverToAgentIds,
      clientKey: input.clientKey ? `human:${human.id}:${conversation.id}:${input.clientKey}` : null
    });
    if (result.created) {
      this.conversationLogger.onMessagePosted(
        conversation.id,
        result.message.id,
        deliverToAgentIds.length
      );
    }
    return result;
  }

  // Oldest first. A member added with history 'from_now' sees nothing from before they joined.
  async listMessages(
    actorId: string,
    conversationId: string,
    input: { limit: number; offset: number }
  ): Promise<Message[]> {
    const { conversation, member } = await this.requireAccess(actorId, conversationId);
    return this.messageRepository.list(conversation.id, {
      since: member?.historyFrom ?? null,
      ...input
    });
  }

  // Documents: knowledge sources people attach for the agents in a conversation. Agents read
  // them but can't change them, and they are never mixed up with agents' saved notes.

  async addDocument(
    actorId: string,
    conversationId: string,
    input: { title: string; content: string }
  ): Promise<ConversationDocument> {
    const { conversation, human } = await this.requireAccess(actorId, conversationId, {
      memberOnly: true
    });
    const document = await this.documentRepository.add({
      conversationId: conversation.id,
      title: input.title,
      content: input.content,
      addedByHumanId: human.id
    });
    this.conversationLogger.onDocumentAdded(document.id, conversation.id);
    return document;
  }

  async listDocuments(actorId: string, conversationId: string): Promise<ConversationDocument[]> {
    const { conversation } = await this.requireAccess(actorId, conversationId);
    return this.documentRepository.list(conversation.id);
  }

  async deleteDocument(actorId: string, conversationId: string, documentId: string): Promise<void> {
    const { conversation } = await this.requireAccess(actorId, conversationId, {
      memberOnly: true
    });
    const document = await this.documentRepository.get(documentId);
    if (!document || document.conversationId !== conversation.id) {
      throw new AppError('documentNotFound', `Document ${documentId} was not found`);
    }
    await this.documentRepository.delete(document.id);
  }

  // Members can read and post. Admins can read any conversation and manage its members, but
  // must be a member to post.
  private async requireAccess(
    actorId: string,
    conversationId: string,
    options: { memberOnly?: boolean } = {}
  ): Promise<{ conversation: Conversation; human: Human; member: ConversationMember | null }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const conversation = await this.conversationRepository.getById(conversationId);
    if (!conversation) {
      throw new AppError('conversationNotFound', `Conversation ${conversationId} was not found`);
    }
    const member = await this.conversationRepository.getMember(conversation.id, {
      type: 'human',
      id: human.id
    });
    if (!member && (options.memberOnly || !hasFullAccess(human))) {
      throw new AppError('notConversationMember');
    }
    return { conversation, human, member };
  }

  private async requireParticipant(participant: ParticipantRef): Promise<void> {
    if (participant.type === 'human') {
      if (!(await this.humanRepository.getById(participant.id))) {
        throw new AppError('participantNotFound', `Person ${participant.id} was not found`);
      }
      return;
    }
    const agent = await this.agentRepository.getById(participant.id);
    if (!agent) {
      throw new AppError('participantNotFound', `Agent ${participant.id} was not found`);
    }
    if (agent.disabledAt || !agent.currentVersionId) {
      throw new AppError('agentUnavailable', `Agent ${agent.name} can't join conversations now`);
    }
  }

  private async loadDetails(conversation: Conversation): Promise<ConversationDetails> {
    const members = await this.conversationRepository.listMembers(conversation.id);
    const details = await Promise.all(
      members.map(async (member): Promise<MemberDetails> => {
        if (member.participant.type === 'agent') {
          const agent = await this.agentRepository.getById(member.participant.id);
          return {
            ...member,
            name: agent?.name ?? 'Unknown agent',
            deleted: Boolean(agent?.deletedAt),
            purpose: agent?.purpose ?? null
          };
        }
        const human = await this.humanRepository.getById(member.participant.id);
        return { ...member, name: human?.name ?? 'Unknown person', purpose: null };
      })
    );
    return { ...conversation, members: details };
  }
}

function isSameParticipant(a: ParticipantRef, b: ParticipantRef): boolean {
  return a.type === b.type && a.id === b.id;
}
