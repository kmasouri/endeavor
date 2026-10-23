import { randomUUID } from 'node:crypto';
import {
  AgentRepository,
  ConversationRepository,
  HumanRepository,
  ResponsibilityRepository,
  TaskRepository
} from '../../data';
import { ResponsibilityLogger, TaskLogger } from '../../observability';
import { ADMIN_ONLY, requireHuman } from '../../shared/access';
import { AppError } from '../../shared/errors';
import { MissedRunPolicy, Responsibility, ResponsibilityStatus, Task } from '../../shared/types';
import { startResponsibilityRun } from './scheduled-runs';
import { TaskLifecycle } from './task-lifecycle';

export interface ResponsibilityInput {
  agentId: string;
  conversationId?: string;
  title: string;
  brief: string;
  completionCriteria: string;
  intervalMinutes: number;
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
    taskLogger: TaskLogger
  ) {
    this.lifecycle = new TaskLifecycle(taskRepository, taskLogger);
  }

  async create(actorId: string, input: ResponsibilityInput): Promise<Responsibility> {
    const admin = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const agent = await this.agentRepository.getById(input.agentId);
    if (!agent) {
      throw new AppError('agentNotFound', `Agent ${input.agentId} was not found`);
    }
    if (agent.disabledAt || !agent.currentVersionId) {
      throw new AppError('agentUnavailable', `${agent.name} can't run scheduled work now`);
    }
    if (input.conversationId) {
      const member = await this.conversationRepository.getMember(input.conversationId, {
        type: 'agent',
        id: agent.id
      });
      if (!member) {
        throw new AppError(
          'agentNotInConversation',
          `${agent.name} is not in that conversation. Add it first`
        );
      }
    }

    const responsibility = await this.responsibilityRepository.create({
      agentId: agent.id,
      conversationId: input.conversationId ?? null,
      title: input.title,
      brief: input.brief,
      completionCriteria: input.completionCriteria,
      intervalMinutes: input.intervalMinutes,
      missedRunPolicy: input.missedRunPolicy ?? 'run_once',
      nextRunAt: input.startAt ?? new Date(),
      createdByHumanId: admin.id
    });
    this.responsibilityLogger.onResponsibilityCreated(responsibility.id, agent.id);
    return responsibility;
  }

  async list(
    actorId: string,
    input: { agentId?: string; status?: ResponsibilityStatus; limit: number; offset: number }
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

  // Run history, newest first. Only admins see runs here; members see runs through /tasks.
  async listRuns(
    actorId: string,
    responsibilityId: string,
    input: { limit: number; offset: number }
  ): Promise<{ tasks: Task[]; total: number }> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    await this.requireResponsibility(responsibilityId);
    const [tasks, total] = await Promise.all([
      this.taskRepository.list({ responsibilityId, ...input }),
      this.taskRepository.count({ responsibilityId })
    ]);
    return { tasks, total };
  }

  // Changes apply to future runs. Runs already started keep what they started with.
  async update(
    actorId: string,
    responsibilityId: string,
    changes: {
      title?: string;
      brief?: string;
      completionCriteria?: string;
      intervalMinutes?: number;
      missedRunPolicy?: MissedRunPolicy;
      nextRunAt?: Date;
    }
  ): Promise<Responsibility> {
    requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const responsibility = await this.requireResponsibility(responsibilityId);
    // A shorter interval takes effect at once, not after the old, longer wait.
    let nextRunAt = changes.nextRunAt;
    if (!nextRunAt && changes.intervalMinutes !== undefined) {
      const sooner = new Date(
        (responsibility.lastRunAt ?? new Date()).getTime() + changes.intervalMinutes * 60_000
      );
      nextRunAt = sooner < responsibility.nextRunAt ? sooner : undefined;
    }
    const updated = await this.responsibilityRepository.update(responsibility.id, {
      ...changes,
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
      status === 'enabled' && responsibility.nextRunAt < new Date() ? new Date() : undefined;
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
  ): Promise<{ task: Task; created: boolean }> {
    const human = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const responsibility = await this.requireResponsibility(responsibilityId);
    if (responsibility.status === 'cancelled') {
      throw new AppError('responsibilityCancelled');
    }
    const result = await startResponsibilityRun(
      {
        taskRepository: this.taskRepository,
        agentRepository: this.agentRepository,
        conversationRepository: this.conversationRepository,
        lifecycle: this.lifecycle
      },
      responsibility,
      {
        runKey: input.runKey
          ? `manual:${responsibility.id}:${input.runKey}`
          : `manual:${responsibility.id}:${randomUUID()}`,
        startedBy: { type: 'human', id: human.id },
        note: input.note
      }
    );
    if ('skippedReason' in result) {
      throw new AppError(
        result.openRunId ? 'responsibilityRunOpen' : 'agentUnavailable',
        result.skippedReason
      );
    }
    return result;
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
