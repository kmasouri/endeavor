import { randomUUID } from 'node:crypto';
import {
  AgentRepository,
  ConversationRepository,
  HumanRepository,
  MessageRepository,
  RoutingRepository,
  RoutingSave,
  TaskRepository
} from '../../data';
import {
  RoutingAgent,
  RoutingClient,
  RoutingDecision,
  StarterChoice,
  HandoffChoice
} from '../../integrations';
import { RoutingLogger } from '../../observability';
import { RoutingRecord } from '../../shared/routing';
import { AppError } from '../../shared/errors';
import { Conversation, ConversationMember } from '../../shared/types';
import { hasFullAccess, requireHuman } from '../access/access.rules';

const THRESHOLD = 0.6;
const TIMEOUT_MS = 30_000;
const MAX_HANDOFFS = 8;

export class RoutingService {
  private active = false;
  private readonly shutdown = new AbortController();
  constructor(
    private readonly repository: RoutingRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly agents: AgentRepository,
    private readonly humans: HumanRepository,
    private readonly tasks: TaskRepository,
    private readonly client: RoutingClient | null,
    private readonly logger: RoutingLogger
  ) {}

  stop(): void {
    this.shutdown.abort();
  }

  async tick(): Promise<void> {
    if (this.active || this.shutdown.signal.aborted) return;
    this.active = true;
    try {
      await this.repository.discoverFinished();
      // Bound one tick, so new requests and shutdown stay responsive.
      for (let i = 0; i < 10 && !this.shutdown.signal.aborted; i++) {
        const token = randomUUID();
        const job = await this.repository.claim(token, TIMEOUT_MS + 10_000);
        if (!job) break;
        await this.decide(job, token);
      }
    } finally {
      this.active = false;
    }
  }

  async list(
    actorId: string,
    conversationId: string,
    input: { limit: number; offset: number }
  ): Promise<{ decisions: RoutingRecord[]; total: number }> {
    const { member } = await this.access(actorId, conversationId, false);
    const since = member?.historyFrom ?? null;
    const [decisions, total] = await Promise.all([
      this.repository.list(conversationId, since, input.limit, input.offset),
      this.repository.count(conversationId, since)
    ]);
    return { decisions, total };
  }

  async choose(
    actorId: string,
    conversationId: string,
    id: string,
    input: { agentId: string | null; revision: number }
  ): Promise<RoutingRecord> {
    const { conversation, member } = await this.access(actorId, conversationId, true);
    const job = await this.repository.get(id);
    if (
      !job ||
      job.conversationId !== conversationId ||
      (member?.historyFrom && job.createdAt < member.historyFrom)
    ) {
      throw new AppError('routingNotFound');
    }
    if (!['waiting', 'resolved'].includes(job.status) || job.revision !== input.revision)
      throw new AppError('routingConflict');
    if (job.status === 'resolved' && job.selectedAgentId === input.agentId) return job;
    const candidates = await this.candidates(conversationId, job);
    if (input.agentId && !candidates.some((a) => a.id === input.agentId))
      throw new AppError('agentUnavailable');
    const outcome = input.agentId ? 'agent' : job.kind === 'starter' ? 'none' : 'done';
    const reason = input.agentId
      ? 'A person selected the next agent.'
      : 'A person chose no further agent work.';
    const saved = await this.save(
      job,
      conversation,
      {
        status: 'resolved',
        selectedAgentId: input.agentId,
        outcome,
        reason,
        confidence: job.confidence,
        candidates,
        model: null,
        usage: null
      },
      { actorId }
    );
    if (!saved) throw new AppError('routingConflict');
    return (await this.repository.get(id))!;
  }

  private async access(
    actorId: string,
    conversationId: string,
    memberOnly: boolean
  ): Promise<{ conversation: Conversation; member: ConversationMember | null }> {
    const human = requireHuman(await this.humans.getById(actorId));
    const conversation = await this.conversations.getById(conversationId);
    if (!conversation) throw new AppError('conversationNotFound');
    const member = await this.conversations.getMember(conversationId, {
      type: 'human',
      id: human.id
    });
    if (!member && (memberOnly || !hasFullAccess(human)))
      throw new AppError('notConversationMember');
    if (memberOnly && conversation.state === 'closed') throw new AppError('conversationClosed');
    return { conversation, member };
  }

  private async candidates(conversationId: string, job: RoutingRecord): Promise<RoutingAgent[]> {
    const members = await this.conversations.listMembers(conversationId);
    const source = job.messageId ? await this.messages.getById(job.messageId) : null;
    const task = job.taskId ? await this.tasks.getById(job.taskId) : null;
    const profiles = await this.agents.getProfiles(
      members.filter((m) => m.participant.type === 'agent').map((m) => m.participant.id),
      conversationId
    );
    const candidates: RoutingAgent[] = [];
    for (const member of members) {
      if (member.participant.type !== 'agent' || member.participant.id === task?.ownerAgentId)
        continue;
      // A source hidden by this member's history boundary cannot be delivered to them.
      if (
        member.historyFrom &&
        (source?.createdAt ?? task?.createdAt ?? job.createdAt) < member.historyFrom
      )
        continue;
      const agent = await this.agents.getById(member.participant.id);
      if (!agent || agent.disabledAt || agent.deletedAt || !agent.currentVersionId) continue;
      const profile = profiles.find((p) => p.id === agent.id);
      candidates.push({
        id: agent.id,
        name: agent.name,
        purpose: [agent.purpose, profile?.produces, profile?.needs, ...(profile?.skillNames ?? [])]
          .filter(Boolean)
          .join('\n')
      });
    }
    return candidates;
  }

  private async decide(job: RoutingRecord, token: string): Promise<void> {
    const conversation = await this.conversations.getById(job.conversationId);
    // Closed endeavors stay dormant; reopening lets their pending decisions continue.
    if (!conversation || conversation.state === 'closed') return;
    const candidates = await this.candidates(job.conversationId, job);
    let decision: RoutingDecision<StarterChoice | HandoffChoice> | null = null;
    let skipped = false;
    let scheduled = false;
    let reason = '';
    try {
      const members = await this.conversations.listMembers(job.conversationId);
      const visibleSince = members.reduce<Date | null>(
        (since, m) => (m.historyFrom && (!since || m.historyFrom > since) ? m.historyFrom : since),
        null
      );
      const recent = (
        await this.messages.listRecent(job.conversationId, { since: visibleSince, limit: 20 })
      ).map((m) => ({ author: m.authorType, body: m.body.slice(0, 4000) }));
      const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(TIMEOUT_MS)]);
      if (job.kind === 'starter') {
        const message = job.messageId ? await this.messages.getById(job.messageId) : null;
        scheduled = Boolean(message && await this.tasks.isScheduledStarter(message.id));
        if (
          !message ||
          (!scheduled && message.authorType !== 'human') ||
          message.mentions.length ||
          message.inReplyToMessageId
        )
          skipped = true;
        else if (this.client && candidates.length)
          decision = await this.client.chooseStarter({
            message: message.body,
            goal: conversation.goal ?? message.body,
            agents: candidates,
            recent,
            signal
          });
      } else {
        const task = job.taskId ? await this.tasks.getById(job.taskId) : null;
        const outgoing = task ? await this.repository.taskMessages(task.id) : [];
        if (!task || outgoing.some((m) => m.delivered)) skipped = true;
        else {
          let depth = 0;
          let parent = task.parentTaskId;
          while (parent && depth < MAX_HANDOFFS) {
            depth++;
            parent = (await this.tasks.getById(parent))?.parentTaskId ?? null;
          }
          const finished = await this.agents.getById(task.ownerAgentId);
          if (depth >= MAX_HANDOFFS)
            reason = 'The automatic handoff limit was reached. Please choose what happens next.';
          else if (this.client && finished && !finished.deletedAt) {
            const outputs = await this.tasks.listOutputs(task.id);
            decision = await this.client.chooseAfterTask({
              goal: `${conversation.goal ?? task.brief}\nDone criteria: ${conversation.doneCriteria ?? ''}`,
              finishedAgent: { id: finished.id, name: finished.name, purpose: finished.purpose },
              result:
                outputs
                  .filter((o) => o.title === 'Result')
                  .at(-1)
                  ?.content?.slice(0, 20_000) ?? '',
              agents: [
                { id: finished.id, name: finished.name, purpose: finished.purpose },
                ...candidates
              ],
              recent,
              signal
            });
          }
        }
      }
    } catch (error) {
      if (this.shutdown.signal.aborted) return;
      this.logger.onFailure(job.id, error);
      reason = 'The routing model could not decide. Please choose what happens next.';
    }
    if (this.shutdown.signal.aborted) return;
    const pick = decision?.choice;
    const confident =
      decision &&
      Number.isFinite(decision.confidence) &&
      decision.confidence >= THRESHOLD &&
      decision.confidence <= 1;
    const selected = pick?.kind === 'agent' ? candidates.find((a) => a.id === pick.agentId) : null;
    const outcome = skipped
      ? 'skipped'
      : confident && pick && (!scheduled || pick.kind !== 'none') && (pick.kind !== 'agent' || selected)
        ? pick.kind
        : 'ask';
    const confidence =
      decision && Number.isFinite(decision.confidence)
        ? Math.max(0, Math.min(1, decision.confidence))
        : 0;
    reason ||=
      outcome === 'agent'
        ? `${selected!.name}'s profile fits the next step toward this endeavor's goal.`
        : outcome === 'none'
          ? 'No agent will act on this message: it does not ask for work.'
          : outcome === 'done'
            ? 'The result meets the endeavor goal; no further agent work was selected.'
            : 'Who should act next? Choose an agent or No one. Work waits until you choose.';
    await this.save(
      job,
      conversation,
      {
        status: skipped ? 'skipped' : outcome === 'ask' ? 'waiting' : 'resolved',
        selectedAgentId: outcome === 'agent' ? selected!.id : null,
        outcome,
        reason,
        confidence,
        candidates: candidates.map(({ id, name }) => ({ id, name })),
        model: decision?.servedModel ?? null,
        usage: decision?.usage ?? null
      },
      { token }
    );
  }

  private async save(
    job: RoutingRecord,
    conversation: Conversation,
    input: RoutingSave,
    options: { token?: string; actorId?: string }
  ): Promise<boolean> {
    const selected = input.selectedAgentId;
    const task = job.taskId ? await this.tasks.getById(job.taskId) : null;
    const handoff = job.kind === 'handoff' && selected && task;
    const source = job.messageId ? await this.messages.getById(job.messageId) : null;
    const manualStarter = options.actorId && selected && job.kind === 'starter';
    const body = manualStarter
      ? `@${input.candidates.find((a) => a.id === selected)?.name}: ${source?.body ?? conversation.goal ?? ''}`
      : handoff
        ? `@${input.candidates.find((a) => a.id === selected)?.name}: Continue toward this endeavor's goal: ${conversation.goal ?? task.brief}\n\n${input.reason}`
        : input.reason;
    let cancelTask: { id: string; state: string } | undefined;
    if (options.actorId && job.deliveryMessageId) {
      const delivered = await this.repository.delivery(job.deliveryMessageId);
      const target = delivered?.taskId ? await this.tasks.getById(delivered.taskId) : null;
      if (target && !['completed', 'cancelled'].includes(target.state)) {
        if (target.requestMessageId !== job.deliveryMessageId)
          throw new AppError('routingConflict');
        cancelTask = { id: target.id, state: target.state };
      }
    }
    const saved = await this.repository.save(job.id, job.revision, input, {
      ...options,
      cancelTask,
      deliveryMessageId:
        selected && job.kind === 'starter' && !manualStarter ? job.messageId : null,
      message:
        input.status === 'skipped'
          ? null
          : {
              conversationId: job.conversationId,
              authorType: manualStarter ? 'human' : handoff ? 'agent' : 'system',
              authorId: manualStarter ? options.actorId! : handoff ? task.ownerAgentId : null,
              body,
              mentions: handoff || manualStarter ? [{ type: 'agent', id: selected }] : [],
              inReplyToMessageId: job.messageId,
              taskId: handoff ? task.id : null,
              deliverToAgentIds: handoff || manualStarter ? [selected] : [],
              clientKey: `routing:${job.id}:${job.revision}`
            }
    });
    if (saved) this.logger.onDecision(job.id, input.outcome, input.confidence, input.model);
    return saved;
  }
}
