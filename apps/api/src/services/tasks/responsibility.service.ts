import { randomUUID } from 'node:crypto';
import {
  AgentRepository,
  ConversationRepository,
  HumanRepository,
  ProjectRepository,
  ResponsibilityRepository,
  TaskRepository
} from '../../data';
import { ResponsibilityLogger, TaskLogger } from '../../observability';
import { ADMIN_ONLY, requireHuman } from '../access/access.rules';
import { AppError } from '../../shared/errors';
import {
  CalendarRecurrence,
  MissedRunPolicy,
  Responsibility,
  ResponsibilityStatus,
  ResponsibilityRun
} from '../../shared/types';
import { findNextCalendarRun } from './calendar';
import { responsibilityRunError, startResponsibilityRun } from './scheduled-runs';
import { TaskLifecycle } from './task-lifecycle';

export interface ResponsibilityInput {
  projectId?: string;
  agentId?: string | null;
  conversationId?: string;
  title: string;
  brief: string;
  completionCriteria: string;
  intervalMinutes?: number;
  recurrence?: CalendarRecurrence;
  missedRunPolicy?: MissedRunPolicy;
  // When the first run is due. Defaults to now.
  startAt?: Date;
}

// Recurring responsibilities: work an agent does on a schedule, with no one asking each time.
// This lives in the tasks feature because each run is a task, and it shares TaskLifecycle and
// startResponsibilityRun with the runner (services can't import across feature folders).
// Only admins set them up and change them. The schedule's status is separate from its runs:
// pausing or cancelling it never stops a run that is already going, and cancelling a run never
// changes the schedule.
export class ResponsibilityService {
  private readonly lifecycle: TaskLifecycle;

  constructor(
    private readonly responsibilityRepository: ResponsibilityRepository,
    private readonly taskRepository: TaskRepository,
    private readonly agentRepository: AgentRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly humanRepository: HumanRepository,
    private readonly responsibilityLogger: ResponsibilityLogger,
    taskLogger: TaskLogger,
    private readonly projectRepository: ProjectRepository
  ) {
    this.lifecycle = new TaskLifecycle(taskRepository, taskLogger);
  }

  async create(actorId: string, input: ResponsibilityInput): Promise<Responsibility> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const conversation = input.conversationId
      ? await this.conversationRepository.getById(input.conversationId)
      : null;
    if (input.conversationId && !conversation) throw new AppError('conversationNotFound');
    if (conversation && input.projectId && input.projectId !== conversation.projectId) {
      throw new AppError('validationError', 'The endeavor belongs to a different project.');
    }
    const projectId = input.projectId ?? conversation?.projectId;
    const project = projectId
      ? await this.projectRepository.getById(projectId)
      : await this.projectRepository.getDefault();
    if (!project) throw new AppError('projectNotFound');
    if (project.archivedAt) throw new AppError('projectArchived');

    const agentId = input.agentId ?? null;
    await this.validatePinnedAgent(agentId);
    const responsibility = await this.responsibilityRepository.create({
      projectId: project.id,
      agentId,
      conversationId: input.conversationId ?? null,
      title: input.title,
      brief: input.brief,
      completionCriteria: input.completionCriteria,
      intervalMinutes: input.intervalMinutes ?? null,
      recurrence: input.recurrence ?? null,
      missedRunPolicy: input.missedRunPolicy ?? 'ask',
      nextRunAt: input.recurrence
        ? findNextCalendarRun(input.recurrence, new Date())
        : (input.startAt ?? new Date()),
      createdByHumanId: admin.id
    });
    this.responsibilityLogger.onResponsibilityCreated(responsibility.id, agentId);
    return responsibility;
  }

  async list(
    actorId: string,
    input: { agentId?: string; projectId?: string; status?: ResponsibilityStatus; limit: number; offset: number }
  ): Promise<{ responsibilities: Responsibility[]; total: number }> {
    requireHuman(await this.humanRepository.getById(actorId));
    const [responsibilities, total] = await Promise.all([
      this.responsibilityRepository.list(input),
      this.responsibilityRepository.count(input)
    ]);
    return { responsibilities, total };
  }

  async get(actorId: string, responsibilityId: string): Promise<Responsibility> {
    requireHuman(await this.humanRepository.getById(actorId));
    return this.requireResponsibility(responsibilityId);
  }

  async listRuns(
    actorId: string,
    responsibilityId: string,
    input: { limit: number; offset: number }
  ): Promise<{ runs: ResponsibilityRun[]; total: number }> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireResponsibility(responsibilityId);
    return this.taskRepository.listResponsibilityRuns(responsibilityId, input.limit, input.offset);
  }

  // Changes apply to future runs. Runs already started keep what they started with.
  async update(
    actorId: string,
    responsibilityId: string,
    changes: {
      agentId?: string | null;
      title?: string;
      brief?: string;
      completionCriteria?: string;
      intervalMinutes?: number;
      recurrence?: CalendarRecurrence;
      missedRunPolicy?: MissedRunPolicy;
      nextRunAt?: Date;
    }
  ): Promise<Responsibility> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const responsibility = await this.requireResponsibility(responsibilityId);
    if (changes.agentId !== undefined) await this.validatePinnedAgent(changes.agentId);
    // A shorter interval takes effect at once, not after the old, longer wait.
    let nextRunAt = changes.nextRunAt;
    const recurrence =
      changes.recurrence ??
      (changes.intervalMinutes !== undefined ? null : responsibility.recurrence);
    if (recurrence && changes.nextRunAt) {
      throw new AppError(
        'validationError',
        'Calendar rules compute their next slot; omit nextRunAt'
      );
    }
    if (changes.recurrence) {
      nextRunAt = findNextCalendarRun(changes.recurrence, new Date());
    }
    if (!nextRunAt && changes.intervalMinutes !== undefined) {
      const sooner = new Date(
        (responsibility.recurrence
          ? new Date()
          : (responsibility.lastRunAt ?? new Date())
        ).getTime() +
          changes.intervalMinutes * 60_000
      );
      nextRunAt =
        responsibility.recurrence || sooner < responsibility.nextRunAt ? sooner : undefined;
    }
    const updated = await this.responsibilityRepository.update(responsibility.id, {
      ...changes,
      ...(changes.recurrence && { intervalMinutes: null }),
      ...(changes.intervalMinutes !== undefined && { recurrence: null }),
      nextRunAt
    });
    if (!updated) {
      throw new AppError('responsibilityCancelled');
    }
    return updated;
  }

  async setStatus(
    actorId: string,
    responsibilityId: string,
    status: ResponsibilityStatus
  ): Promise<Responsibility> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const responsibility = await this.requireResponsibility(responsibilityId);
    if (responsibility.status === 'cancelled') {
      throw new AppError('responsibilityCancelled');
    }
    if (responsibility.status === status) {
      return responsibility;
    }
    // Resuming after a pause starts from now; the paused time doesn't count as missed runs.
    const nextRunAt =
      status === 'enabled'
        ? responsibility.recurrence
          ? findNextCalendarRun(responsibility.recurrence, new Date())
          : responsibility.nextRunAt < new Date()
            ? new Date()
            : undefined
        : undefined;
    // The repository never changes a cancelled responsibility, so a cancel racing a resume
    // can't bring it back.
    const updated = await this.responsibilityRepository.update(responsibility.id, {
      status,
      nextRunAt
    });
    if (!updated) {
      throw new AppError('responsibilityCancelled');
    }
    this.responsibilityLogger.onResponsibilityStatusChanged(responsibility.id, status);
    return updated;
  }

  // Starts a run now, outside the schedule: a person asking, or an outside event. The
  // schedule itself doesn't change. Send the same runKey again to get the same run back.
  async startRun(
    actorId: string,
    responsibilityId: string,
    input: { runKey?: string; note?: string }
  ): Promise<{ run: ResponsibilityRun; created: boolean }> {
    const human = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const responsibility = await this.requireResponsibility(responsibilityId);
    if (responsibility.status === 'cancelled') {
      throw new AppError('responsibilityCancelled');
    }
    const result = await startResponsibilityRun(
      this.taskRepository,
      this.lifecycle,
      responsibility,
      {
        runKey: input.runKey
          ? `manual:${responsibility.id}:${input.runKey}`
          : `manual:${responsibility.id}:${randomUUID()}`,
        startedBy: { type: 'human', id: human.id },
        note: input.note
      }
    );
    if ('reason' in result) throw responsibilityRunError(result.reason);
    return { run: result.run, created: result.created };
  }

  // Answers "missed runs: run now, or wait?". Only the first answer counts, and an answer after
  // the next run came due finds nothing to answer.
  async resolveCatchUp(
    actorId: string,
    responsibilityId: string,
    decision: 'run' | 'wait'
  ): Promise<{ responsibility: Responsibility; run: ResponsibilityRun | null }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const responsibility = await this.requireResponsibility(responsibilityId);
    const pending = responsibility.catchUp;
    if (!pending) return this.replayCatchUp(responsibility, decision);
    const cleared = { ...responsibility, catchUp: null };
    if (decision === 'wait') {
      const result = await this.taskRepository.waitForNextResponsibilityRun(
        responsibility.id, pending.slot
      );
      if (!result) return this.replayCatchUp(responsibility, decision, pending.slot);
      this.responsibilityLogger.onCatchUpResolved(responsibility.id, decision);
      return { responsibility: cleared, run: null };
    }
    const result = await startResponsibilityRun(
      this.taskRepository,
      this.lifecycle,
      responsibility,
      {
        runKey: `catchup:${responsibility.id}:${pending.slot.toISOString()}`,
        startedBy: { type: 'human', id: human.id },
        catchUpSlot: pending.slot,
        note: `(Catching up: ${pending.missed} scheduled run${pending.missed === 1 ? ' was' : 's were'} missed while the platform was off. ${human.name} asked to run now.)`
      }
    );
    if ('reason' in result) {
      if (result.reason === 'changed') return this.replayCatchUp(responsibility, decision, pending.slot);
      throw responsibilityRunError(result.reason);
    }
    this.responsibilityLogger.onCatchUpResolved(responsibility.id, decision);
    return { responsibility: cleared, run: result.run };
  }

  private async replayCatchUp(
    responsibility: Responsibility,
    decision: 'run' | 'wait',
    slot?: Date
  ): Promise<{ responsibility: Responsibility; run: ResponsibilityRun | null }> {
    const saved = await this.responsibilityRepository.getCatchUpDecision(responsibility.id, slot);
    if (!saved || saved.decision !== decision) throw new AppError('catchUpNotPending');
    const legacyTask = saved.taskId ? await this.taskRepository.getById(saved.taskId) : null;
    const runKey = saved.runKey ?? legacyTask?.runKey;
    const run = runKey ? await this.taskRepository.getResponsibilityRun(runKey) : null;
    if (decision === 'run' && !run) throw new AppError('catchUpNotPending');
    return { responsibility: { ...responsibility, catchUp: null }, run };
  }

  private async validatePinnedAgent(agentId: string | null): Promise<void> {
    if (!agentId) return;
    const agent = await this.agentRepository.getById(agentId);
    if (!agent) throw new AppError('agentNotFound', `Agent ${agentId} was not found`);
    if (agent.disabledAt || !agent.currentVersionId) {
      throw new AppError('agentUnavailable', `${agent.name} can't run scheduled work now`);
    }
  }

  private async requireResponsibility(responsibilityId: string): Promise<Responsibility> {
    const responsibility = await this.responsibilityRepository.getById(responsibilityId);
    if (!responsibility) {
      throw new AppError(
        'responsibilityNotFound',
        `Responsibility ${responsibilityId} was not found`
      );
    }
    return responsibility;
  }
}
