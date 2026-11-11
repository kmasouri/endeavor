import {
  AgentRepository,
  ConversationRepository,
  HumanRepository,
  DocumentRepository,
  MessageRepository,
  ProjectRepository
} from '../../data';
import { ConversationLogger } from '../../observability';
import { requireHuman, hasFullAccess } from '../access/access.rules';
import { addressedAgentIds } from './addressing.rules';
import { defaultDoneCriteria } from './goal.rules';
import {
  canonicalConversationName,
  MAX_CONVERSATION_NAME_LENGTH
} from '../../shared/conversation-name';
import { AppError } from '../../shared/errors';
import {
  AgentAppearance,
  Conversation,
  ConversationMember,
  EndeavorState,
  Human,
  Message,
  ParticipantRef,
  Project,
  ProjectDocument
} from '../../shared/types';

function requireChannelName(value: string): string {
  const name = canonicalConversationName(value);
  if (!name || name.length > MAX_CONVERSATION_NAME_LENGTH) {
    throw new AppError('validationError', 'Use a channel name between 1 and 64 characters.');
  }
  return name;
}

export interface MemberDetails extends ConversationMember, AgentAppearance {
  deleted?: boolean;
  name: string;
  // An agent's purpose, so participants know whom to ask. null for humans.
  purpose: string | null;
  produces?: string | null;
  needs?: string | null;
  skillNames?: string[];
  status?: 'idle' | 'busy' | null;
}

export interface ConversationDetails extends Conversation {
  members: MemberDetails[];
}

export interface ConversationSummary extends Conversation {
  // Messages from others the acting person hasn't seen. Always 0 where they aren't a member.
  unreadCount: number;
}

// Shared conversations between humans and agents; the web app calls them endeavors. Each one is
// one goal inside a project: it opens when someone asks for something and closes when a person
// confirms the goal is done. Humans post here through the API; agents post through the runner.
// Posting a message only saves it and records which agents it is addressed to. The runner turns
// those into work.
export class ConversationService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly conversationLogger: ConversationLogger
  ) {}

  // Starts an endeavor in the project (the default project when none is named). The project's
  // default people and agents join it along with the chosen ones. Without a goal, the first
  // message a person posts becomes the goal.
  async createConversation(
    actorId: string,
    input: {
      title: string;
      projectId?: string | null;
      goal?: string;
      doneCriteria?: string;
      agentIds?: string[];
      humanIds?: string[];
    }
  ): Promise<ConversationDetails> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const project =
      input.projectId === null ? null : await this.requireOpenProject(input.projectId, human);
    const humanIds = [...new Set(input.humanIds ?? [])].filter((id) => id !== human.id);
    const agentIds = [...new Set(input.agentIds ?? [])];
    for (const humanId of humanIds) {
      await this.requireParticipant({ type: 'human', id: humanId });
    }
    for (const agentId of agentIds) {
      await this.requireParticipant({ type: 'agent', id: agentId });
    }
    // Project defaults that can't join now, like a disabled agent, are skipped, not an error.
    for (const member of project ? await this.projectRepository.listMembers(project.id) : []) {
      const { type, id } = member.participant;
      const chosen = type === 'human' ? humanIds : agentIds;
      if (id === human.id || chosen.includes(id) || !(await this.canJoin(member.participant))) {
        continue;
      }
      chosen.push(id);
    }

    const goal = input.goal ?? null;
    const conversation = await this.conversationRepository.create({
      title: requireChannelName(input.title),
      projectId: project?.id ?? null,
      goal,
      doneCriteria: input.doneCriteria ?? (goal ? defaultDoneCriteria(goal) : null),
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

  // Admins see every conversation. Members see the ones they belong to. Open endeavors are listed
  // by default; closed ones are archived and listed with state 'closed' or 'all'.
  async listConversations(
    actorId: string,
    input: { limit: number; offset: number; projectId?: string; state?: EndeavorState | 'all' }
  ): Promise<{ conversations: ConversationSummary[]; total: number }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const participant: ParticipantRef | null = hasFullAccess(human)
      ? null
      : { type: 'human', id: human.id };
    const filter = {
      participant,
      projectId: input.projectId ?? null,
      state: input.state ?? 'open'
    };
    const [conversations, total] = await Promise.all([
      this.conversationRepository.list({ ...filter, limit: input.limit, offset: input.offset }),
      this.conversationRepository.count(filter)
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

  // Setting a goal on an endeavor that has no done criteria fills them in from the goal.
  async updateConversation(
    actorId: string,
    conversationId: string,
    changes: { title?: string; budgetUsd?: number | null; goal?: string; doneCriteria?: string }
  ): Promise<ConversationDetails> {
    const { conversation } = await this.requireAccess(actorId, conversationId);
    const doneCriteria =
      changes.doneCriteria ??
      (changes.goal !== undefined && conversation.doneCriteria === null
        ? defaultDoneCriteria(changes.goal)
        : undefined);
    const updated = await this.conversationRepository.update(conversation.id, {
      ...changes,
      ...(changes.title !== undefined && { title: requireChannelName(changes.title) }),
      doneCriteria
    });
    return this.loadDetails(updated ?? conversation);
  }

  // A person confirms the goal is done. The endeavor is archived: it leaves the default list and
  // takes no new messages until reopened. Work already running isn't stopped. Closing twice
  // keeps the first close.
  async closeConversation(actorId: string, conversationId: string): Promise<ConversationDetails> {
    const { conversation, human } = await this.requireAccess(actorId, conversationId);
    if (conversation.state === 'closed') {
      return this.loadDetails(conversation);
    }
    const closed = await this.conversationRepository.setClosed(conversation.id, human.id);
    this.conversationLogger.onConversationClosed(conversation.id, human.id);
    return this.loadDetails(closed ?? conversation);
  }

  // Reopens a closed endeavor for follow-ups. Its goal, history, and work stay as they were.
  async reopenConversation(actorId: string, conversationId: string): Promise<ConversationDetails> {
    const { conversation, human } = await this.requireAccess(actorId, conversationId);
    if (conversation.state === 'open') {
      return this.loadDetails(conversation);
    }
    const reopened = await this.conversationRepository.setClosed(conversation.id, null);
    this.conversationLogger.onConversationReopened(conversation.id, human.id);
    return this.loadDetails(reopened ?? conversation);
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
    if (conversation.state === 'closed') {
      throw new AppError('conversationClosed');
    }
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
      routeRequest: mentions.length === 0 && !input.inReplyToMessageId,
      clientKey: input.clientKey ? `human:${human.id}:${conversation.id}:${input.clientKey}` : null
    });
    if (result.created) {
      this.conversationLogger.onMessagePosted(
        conversation.id,
        result.message.id,
        deliverToAgentIds.length
      );
    }
    // The first request a person makes is the endeavor's goal. A retried send (created false)
    // may follow a crash before this step, so it is tried again then too.
    if (conversation.goal === null) {
      const withGoal = await this.conversationRepository.setGoalIfEmpty(conversation.id, {
        goal: result.message.body,
        goalMessageId: result.message.id,
        doneCriteria: defaultDoneCriteria(result.message.body)
      });
      if (withGoal) {
        this.conversationLogger.onGoalSet(conversation.id, result.message.id);
      }
    }
    return result;
  }

  // Oldest first. A member added with history 'from_now' sees nothing from before they joined.
  async listMessages(
    actorId: string,
    conversationId: string,
    input: { limit: number; offset: number; latest?: boolean; beforeId?: string; afterId?: string }
  ): Promise<Message[]> {
    const { conversation, member } = await this.requireAccess(actorId, conversationId);
    if (input.latest || input.beforeId || input.afterId) {
      const cursorId = input.beforeId ?? input.afterId;
      if (cursorId) {
        const anchor = await this.messageRepository.getById(cursorId);
        if (
          !anchor ||
          anchor.conversationId !== conversation.id ||
          (member?.historyFrom && anchor.createdAt < member.historyFrom)
        ) {
          throw new AppError('messageNotFound', `Message ${cursorId} was not found`);
        }
      }
      return this.messageRepository.listWindow(conversation.id, {
        since: member?.historyFrom ?? null,
        limit: input.limit,
        beforeId: input.beforeId,
        afterId: input.afterId
      });
    }
    return this.messageRepository.list(conversation.id, {
      since: member?.historyFrom ?? null,
      ...input
    });
  }

  // Documents: knowledge sources for the agents in a conversation. Agents read them but can't
  // change them, and they are never mixed up with agents' saved notes. Documents added here are
  // limited to this one endeavor; ones added to its project are shared by all its endeavors.

  async addDocument(
    actorId: string,
    conversationId: string,
    input: { title: string; content: string }
  ): Promise<ProjectDocument> {
    const { conversation, human } = await this.requireAccess(actorId, conversationId, {
      memberOnly: true
    });
    const document = await this.documentRepository.add({
      projectId: conversation.projectId,
      conversationId: conversation.id,
      title: input.title,
      content: input.content,
      addedByHumanId: human.id
    });
    this.conversationLogger.onDocumentAdded(document.id, conversation.id);
    return document;
  }

  // The project's shared documents, plus the ones limited to this endeavor.
  async listDocuments(actorId: string, conversationId: string): Promise<ProjectDocument[]> {
    const { conversation } = await this.requireAccess(actorId, conversationId);
    return this.documentRepository.list({ conversationId: conversation.id });
  }

  async deleteDocument(actorId: string, conversationId: string, documentId: string): Promise<void> {
    const { conversation } = await this.requireAccess(actorId, conversationId, {
      memberOnly: true
    });
    const document = await this.documentRepository.get(documentId);
    if (
      !document ||
      document.projectId !== conversation.projectId ||
      (document.conversationId !== null && document.conversationId !== conversation.id)
    ) {
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

  private async requireOpenProject(projectId: string | undefined, human: Human): Promise<Project> {
    const project = projectId
      ? await this.projectRepository.getById(projectId)
      : await this.projectRepository.getDefault();
    if (
      !project ||
      (projectId &&
        !hasFullAccess(human) &&
        !(await this.projectRepository.hasHuman(project.id, human.id)))
    ) {
      throw new AppError('projectNotFound', `Project ${projectId ?? '(default)'} was not found`);
    }
    if (project.archivedAt) {
      throw new AppError('projectArchived');
    }
    return project;
  }

  private async canJoin(participant: ParticipantRef): Promise<boolean> {
    try {
      await this.requireParticipant(participant);
      return true;
    } catch (error) {
      if (error instanceof AppError) {
        return false;
      }
      throw error;
    }
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
    const profiles = new Map(
      (
        await this.agentRepository.getProfiles(
          members
            .filter((member) => member.participant.type === 'agent')
            .map((member) => member.participant.id),
          conversation.id
        )
      ).map((profile) => [profile.id, profile])
    );
    const details = await Promise.all(
      members.map(async (member): Promise<MemberDetails> => {
        if (member.participant.type === 'agent') {
          const agent = await this.agentRepository.getById(member.participant.id);
          return {
            ...member,
            name: agent?.name ?? 'Unknown agent',
            deleted: Boolean(agent?.deletedAt),
            purpose: agent?.deletedAt ? null : (agent?.purpose ?? null),
            produces: profiles.get(member.participant.id)?.produces ?? null,
            needs: profiles.get(member.participant.id)?.needs ?? null,
            skillNames: profiles.get(member.participant.id)?.skillNames ?? [],
            status: profiles.get(member.participant.id)?.status ?? null,
            avatarColor: agent?.avatarColor ?? null,
            avatarIcon: agent?.avatarIcon ?? null
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
