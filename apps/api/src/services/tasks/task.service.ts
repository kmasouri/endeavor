import { randomUUID } from 'node:crypto';
import {
  AgentRepository,
  CostSummary,
  TaskCost,
  ApprovalRepository,
  ConversationRepository,
  CreateTaskOutputInput,
  CreateTaskWaitInput,
  HumanRepository,
  ListTasksInput,
  TaskRepository
} from '../../data';
import { TaskLogger } from '../../observability';
import { ADMIN_ONLY, requireHuman, hasFullAccess } from '../../shared/access';
import { AppError } from '../../shared/errors';
import {
  Actor,
  Agent,
  Approval,
  ApprovalStatus,
  Human,
  Task,
  TaskEvent,
  TaskOutput
} from '../../shared/types';
import { startOfMonth } from './pricing';
import {
  describeState,
  ignoreWaitAlreadyResolved,
  TaskDetails,
  TaskLifecycle
} from './task-lifecycle';
import { isFinished } from './task-state';

export interface CreateTaskRequest {
  ownerAgentId: string;
  title: string;
  brief: string;
  completionCriteria: string;
  reviewRequired?: boolean;
  // A key chosen by the caller. Sending the same key again returns the same task.
  runKey?: string;
}

// Owns the task lifecycle: creating tasks, moving them between states, waits, outputs, and the
// execution history. Human actions check the acting person. Lifecycle actions (wait, complete,
// block) are for the runner, which acts for the agent that owns the task.
export interface CostReport {
  total: CostSummary;
  thisMonth: CostSummary;
  budgetUsd: number | null;
  tasks: TaskCost[];
}

export class TaskService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly approvalRepository: ApprovalRepository,
    private readonly taskLogger: TaskLogger
  ) {
    this.lifecycle = new TaskLifecycle(taskRepository, taskLogger);
  }

  private readonly lifecycle: TaskLifecycle;

  async createTask(
    actorId: string,
    input: CreateTaskRequest
  ): Promise<{ task: Task; created: boolean }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const agent = await this.requireAvailableAgent(input.ownerAgentId);

    const { task, created } = await this.taskRepository.create({
      // A caller's key only matches that caller's own earlier request for the same agent.
      runKey: input.runKey
        ? `client:${human.id}:${agent.id}:${input.runKey}`
        : `human:${randomUUID()}`,
      conversationId: null,
      ownerAgentId: agent.id,
      agentVersionId: agent.currentVersionId as string,
      title: input.title,
      brief: input.brief,
      completionCriteria: input.completionCriteria,
      reviewRequired: input.reviewRequired ?? false,
      requestedByType: 'human',
      requestedById: human.id,
      requestMessageId: null,
      parentTaskId: null,
      restartedFromTaskId: null,
      responsibilityId: null
    });

    if (created) {
      await this.lifecycle.recordCreated(task, { type: 'human', id: human.id });
    }
    return { task, created };
  }

  async getTask(actorId: string, taskId: string): Promise<TaskDetails> {
    const task = await this.requireVisibleTask(actorId, taskId);
    const waits = await this.taskRepository.listWaits(task.id, { openOnly: false });
    return { ...task, waits };
  }

  // Admins see every task. Members see tasks in their conversations and tasks they asked for.
  async listTasks(
    actorId: string,
    input: Omit<ListTasksInput, 'visibleToHumanId'>
  ): Promise<{ tasks: Task[]; total: number }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const filters = {
      state: input.state,
      ownerAgentId: input.ownerAgentId,
      conversationId: input.conversationId,
      ...(!hasFullAccess(human) && { visibleToHumanId: human.id })
    };
    const [tasks, total] = await Promise.all([
      this.taskRepository.list({ ...filters, limit: input.limit, offset: input.offset }),
      this.taskRepository.count(filters)
    ]);
    return { tasks, total };
  }

  async listEvents(
    actorId: string,
    taskId: string,
    options: { afterId: number; limit: number }
  ): Promise<TaskEvent[]> {
    await this.requireVisibleTask(actorId, taskId);
    return this.taskRepository.listEvents(taskId, options);
  }

  async listOutputs(actorId: string, taskId: string): Promise<TaskOutput[]> {
    await this.requireVisibleTask(actorId, taskId);
    return this.taskRepository.listOutputs(taskId);
  }

  // Everything agents attached in one conversation, so people can inspect results and evidence
  // without opening each task.
  async listConversationOutputs(
    actorId: string,
    conversationId: string,
    input: { limit: number; offset: number }
  ): Promise<{ outputs: TaskOutput[]; total: number }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const member = await this.conversationRepository.getMember(conversationId, {
      type: 'human',
      id: human.id
    });
    if (!member && !hasFullAccess(human)) {
      throw new AppError('conversationNotFound', `Conversation ${conversationId} was not found`);
    }
    const [outputs, total] = await Promise.all([
      this.taskRepository.listConversationOutputs(conversationId, input),
      this.taskRepository.countConversationOutputs(conversationId)
    ]);
    return { outputs, total };
  }

  // What an agent spent: in total, this month (UTC), and its costliest tasks, next to its
  // monthly budget.
  async agentCosts(actorId: string, agentId: string): Promise<CostReport> {
    requireHuman(await this.humanRepository.getById(actorId));
    const agent = await this.agentRepository.getById(agentId);
    if (!agent) {
      throw new AppError('agentNotFound', `Agent ${agentId} was not found`);
    }
    const month = startOfMonth(new Date());
    const [total, thisMonth, tasks] = await Promise.all([
      this.taskRepository.sumCost({ agentId }),
      this.taskRepository.sumCost({ agentId, since: month }),
      this.taskRepository.listTaskCosts({ agentId, since: month }, 10)
    ]);
    return { total, thisMonth, budgetUsd: agent.monthlyBudgetUsd, tasks };
  }

  // What all agent work in a conversation spent, next to the conversation's budget.
  async conversationCosts(actorId: string, conversationId: string): Promise<CostReport> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const conversation = await this.conversationRepository.getById(conversationId);
    const member =
      conversation &&
      (hasFullAccess(human) ||
        (await this.conversationRepository.getMember(conversationId, {
          type: 'human',
          id: human.id
        })));
    if (!conversation || !member) {
      throw new AppError('conversationNotFound', `Conversation ${conversationId} was not found`);
    }
    const month = startOfMonth(new Date());
    const [total, thisMonth, tasks] = await Promise.all([
      this.taskRepository.sumCost({ conversationId }),
      this.taskRepository.sumCost({ conversationId, since: month }),
      this.taskRepository.listTaskCosts({ conversationId }, 10)
    ]);
    return { total, thisMonth, budgetUsd: conversation.budgetUsd, tasks };
  }

  // Human actions

  async pauseTask(actorId: string, taskId: string, reason?: string): Promise<Task> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const task = await this.requireVisibleTask(human, taskId);
    if (isFinished(task) || task.pausedAt) {
      throw new AppError('taskStateConflict', `Task ${task.id} is ${describeState(task)}`);
    }

    const paused = await this.lifecycle.applyChanges(task, { pausedAt: new Date() });
    await this.taskRepository.addEvent(task.id, 'task.paused', humanActor(human.id), {
      reason: reason ?? null
    });
    this.taskLogger.onTaskPaused(task.id);
    return paused;
  }

  // Clears a pause, and moves a blocked task back to working. A human resuming a blocked task
  // is how a blocked reason gets resolved.
  async resumeTask(actorId: string, taskId: string, note?: string): Promise<Task> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const actor = humanActor(human.id);
    let task = await this.requireVisibleTask(human, taskId);
    if (isFinished(task) || (!task.pausedAt && task.state !== 'blocked')) {
      throw new AppError('taskStateConflict', `Task ${task.id} is ${describeState(task)}`);
    }

    // One write, so the task is never left half resumed.
    task =
      task.state === 'blocked'
        ? await this.lifecycle.transition(task, 'working', actor, {
            reason: note ?? null,
            changes: { pausedAt: null }
          })
        : await this.lifecycle.applyChanges(task, { pausedAt: null });

    await this.taskRepository.addEvent(task.id, 'task.resumed', actor, { note: note ?? null });
    this.taskLogger.onTaskResumed(task.id);
    return task;
  }

  async cancelTask(actorId: string, taskId: string, reason?: string): Promise<Task> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const task = await this.requireVisibleTask(human, taskId);

    const cancelled = await this.lifecycle.transition(task, 'cancelled', humanActor(human.id), {
      reason: reason ?? null,
      changes: { pausedAt: null, finishedAt: new Date() }
    });
    await this.taskRepository.resolveOpenWaits(task.id, { cancelled: true });
    return cancelled;
  }

  // Restarting finished work creates a new linked task, so the old outcome stays as it was.
  // The new task uses the agent's current configuration. Each task can be restarted once;
  // to run it again, restart the newest one. Asking twice returns the same new task.
  // A restart with a reason is a revision request: the new run sees what was asked to change
  // and the previous result, while the previous run stays as it was.
  private async revisionBrief(previous: Task, reason: string): Promise<string> {
    const result = (await this.taskRepository.listOutputs(previous.id))
      .filter((output) => output.title === 'Result')
      .pop();
    return [
      previous.brief,
      `Changes requested: ${reason}`,
      ...(result?.content ? [`Previous result:\n${result.content.slice(0, 10_000)}`] : [])
    ].join('\n\n');
  }

  async restartTask(
    actorId: string,
    taskId: string,
    reason?: string
  ): Promise<{ task: Task; created: boolean }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const previous = await this.requireVisibleTask(human, taskId);
    if (!isFinished(previous)) {
      throw new AppError(
        'taskStateConflict',
        `Only completed or cancelled tasks can be restarted. Task ${previous.id} is ${describeState(previous)}`
      );
    }

    const runKey = `restart:${previous.id}`;
    const existing = await this.taskRepository.getByRunKey(runKey);
    if (existing) {
      return { task: existing, created: false };
    }

    const agent = await this.requireAvailableAgent(previous.ownerAgentId);
    const actor = humanActor(human.id);

    const { task, created } = await this.taskRepository.create({
      runKey,
      conversationId: previous.conversationId,
      ownerAgentId: agent.id,
      agentVersionId: agent.currentVersionId as string,
      title: previous.title,
      brief: reason ? await this.revisionBrief(previous, reason) : previous.brief,
      completionCriteria: previous.completionCriteria,
      reviewRequired: previous.reviewRequired,
      requestedByType: 'human',
      requestedById: human.id,
      requestMessageId: previous.requestMessageId,
      parentTaskId: previous.parentTaskId,
      restartedFromTaskId: previous.id,
      responsibilityId: previous.responsibilityId
    });

    if (created) {
      await this.lifecycle.recordCreated(task, actor);
      await this.taskRepository.addEvent(previous.id, 'task.restarted', actor, {
        newTaskId: task.id,
        reason: reason ?? null
      });
      this.taskLogger.onTaskRestarted(previous.id, task.id);
    }
    return { task, created };
  }

  // Moves open work to another version of its agent's configuration, usually the newest.
  // Tasks never change version on their own, so this is always a recorded human decision.
  // Admins only, because it changes how running work behaves.
  async migrateTaskVersion(
    actorId: string,
    taskId: string,
    input: { versionId?: string; reason?: string }
  ): Promise<Task> {
    const human = requireHuman(await this.humanRepository.getById(actorId), ADMIN_ONLY);
    const task = await this.lifecycle.requireTask(taskId);
    if (isFinished(task)) {
      throw new AppError(
        'taskStateConflict',
        `Task ${task.id} is ${task.state}. Restart it to run it on a newer version`
      );
    }
    let versionId = input.versionId;
    if (!versionId) {
      const agent = await this.agentRepository.getById(task.ownerAgentId);
      if (!agent?.currentVersionId) {
        throw new AppError('agentUnavailable', `The task's agent has no current configuration`);
      }
      versionId = agent.currentVersionId;
    }
    const version = await this.agentRepository.getVersion(versionId);
    if (!version || version.agentId !== task.ownerAgentId) {
      throw new AppError(
        'agentVersionNotFound',
        `Version ${versionId} is not a version of this task's agent`
      );
    }
    if (version.id === task.agentVersionId) {
      return task;
    }

    const migrated = await this.lifecycle.applyChanges(task, { agentVersionId: version.id });
    await this.taskRepository.addEvent(task.id, 'task.version.migrated', humanActor(human.id), {
      fromVersionId: task.agentVersionId,
      toVersionId: version.id,
      toVersion: version.version,
      reason: input.reason ?? null
    });
    this.taskLogger.onTaskVersionMigrated(task.id, task.agentVersionId, version.id, {
      humanId: human.id,
      reason: input.reason ?? null
    });
    return migrated;
  }

  // A human approves the output of a task waiting for review, which completes it, or asks for
  // changes, which sends it back to working with the notes.
  async reviewTask(
    actorId: string,
    taskId: string,
    input: { approved: boolean; notes?: string }
  ): Promise<Task> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const actor = humanActor(human.id);
    const task = await this.requireVisibleTask(human, taskId);
    const reviewWait = (await this.taskRepository.findOpenWaits('approval', task.id)).find(
      (wait) => wait.taskId === task.id
    );
    if (task.state !== 'waiting' || !reviewWait) {
      throw new AppError('taskStateConflict', `Task ${task.id} is not waiting for review`);
    }

    const review = {
      approved: input.approved,
      notes: input.notes ?? null,
      humanId: human.id,
      reviewedAt: new Date()
    };
    // Change the state first. If another change wins the race, this throws and nothing else
    // has been written, so the review can be tried again.
    const reviewed = input.approved
      ? await this.lifecycle.transition(task, 'completed', actor, {
          changes: { review, pausedAt: null, finishedAt: new Date() }
        })
      : await this.lifecycle.transition(task, 'working', actor, {
          reason: `Review asked for changes${input.notes ? `: ${input.notes}` : ''}`,
          changes: { review }
        });
    await this.taskRepository.resolveWait(reviewWait.id, { review });
    await this.taskRepository.addEvent(task.id, 'task.reviewed', actor, { review });
    return reviewed;
  }

  // Approvals: actions an agent asked to take that need a person first. Admins and the people
  // who can see the task (members of its conversation, or who asked for it) decide.

  async listApprovals(
    actorId: string,
    input: { status?: ApprovalStatus; limit: number; offset: number }
  ): Promise<{ approvals: Approval[]; total: number }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const filters = {
      status: input.status,
      ...(!hasFullAccess(human) && { visibleToHumanId: human.id })
    };
    const [approvals, total] = await Promise.all([
      this.approvalRepository.list({ ...filters, limit: input.limit, offset: input.offset }),
      this.approvalRepository.count(filters)
    ]);
    return { approvals, total };
  }

  async getApproval(actorId: string, approvalId: string): Promise<Approval> {
    return this.requireVisibleApproval(actorId, approvalId);
  }

  // The task keeps waiting: the runner makes the call, records the result, and then wakes it.
  async approve(actorId: string, approvalId: string, reason?: string): Promise<Approval> {
    const approval = await this.requireVisibleApproval(actorId, approvalId);
    const task = await this.lifecycle.requireTask(approval.taskId);
    if (task.state !== 'waiting') {
      throw new AppError(
        'taskStateConflict',
        `The task is ${task.state}, so this action can't be approved. Reject it instead`
      );
    }
    const decided = await this.decide(actorId, approval, 'approved', reason);
    await this.taskRepository.addEvent(decided.taskId, 'approval.approved', humanActor(actorId), {
      approvalId: decided.id,
      reason: reason ?? null
    });
    this.taskLogger.onApprovalApproved(decided.id, decided.taskId);
    return decided;
  }

  // The call is never made. The agent is told why and its task wakes up.
  async reject(actorId: string, approvalId: string, reason?: string): Promise<Approval> {
    const approval = await this.requireVisibleApproval(actorId, approvalId);
    const decided = await this.decide(actorId, approval, 'rejected', reason);
    const actor = humanActor(actorId);
    await this.taskRepository.addEvent(decided.taskId, 'approval.rejected', actor, {
      approvalId: decided.id,
      request: decided.request,
      reason: reason ?? null
    });
    const waits = await this.taskRepository.findOpenWaits('approval', decided.id);
    for (const wait of waits) {
      await this.lifecycle
        .resolveWait(wait.id, actor, { approvalId: decided.id, approved: false })
        .catch(ignoreWaitAlreadyResolved);
    }
    this.taskLogger.onApprovalRejected(decided.id, decided.taskId);
    return decided;
  }

  private async decide(
    actorId: string,
    approval: Approval,
    status: 'approved' | 'rejected',
    reason: string | undefined
  ): Promise<Approval> {
    const decided = await this.approvalRepository.decide({
      approvalId: approval.id,
      status,
      humanId: actorId,
      reason: reason ?? null
    });
    if (!decided) {
      const latest = await this.approvalRepository.getById(approval.id);
      throw new AppError(
        'approvalAlreadyDecided',
        `Approval ${approval.id} was already ${latest?.status ?? 'decided'}`
      );
    }
    return decided;
  }

  private async requireVisibleApproval(actorId: string, approvalId: string): Promise<Approval> {
    const approval = await this.approvalRepository.getById(approvalId);
    if (!approval) {
      throw new AppError('approvalNotFound', `Approval ${approvalId} was not found`);
    }
    await this.requireVisibleTask(actorId, approval.taskId).catch((error) => {
      throw error instanceof AppError && error.name === 'taskNotFound'
        ? new AppError('approvalNotFound', `Approval ${approvalId} was not found`)
        : error;
    });
    return approval;
  }

  // Lifecycle actions, used by the runner for the agent that owns the task. The rules are in
  // TaskLifecycle.

  waitFor(taskId: string, actor: Actor, waits: CreateTaskWaitInput[]): Promise<TaskDetails> {
    return this.lifecycle.waitFor(taskId, actor, waits);
  }

  resolveWait(waitId: string, actor: Actor, resolution: Record<string, unknown>): Promise<Task> {
    return this.lifecycle.resolveWait(waitId, actor, resolution);
  }

  wakeIfReady(taskId: string, actor: Actor): Promise<Task> {
    return this.lifecycle.wakeIfReady(taskId, actor);
  }

  addOutput(taskId: string, actor: Actor, input: CreateTaskOutputInput): Promise<TaskOutput> {
    return this.lifecycle.addOutput(taskId, actor, input);
  }

  completeTask(
    taskId: string,
    actor: Actor,
    check: { met: boolean; summary: string }
  ): Promise<Task> {
    return this.lifecycle.completeTask(taskId, actor, check);
  }

  blockTask(taskId: string, actor: Actor, reason: string): Promise<Task> {
    return this.lifecycle.blockTask(taskId, actor, reason);
  }

  // Not visible reads as not found, so the API doesn't reveal that a task exists.
  // Takes the person if the caller already loaded them, to save a lookup.
  private async requireVisibleTask(actor: string | Human, taskId: string): Promise<Task> {
    const human =
      typeof actor === 'string' ? requireHuman(await this.humanRepository.getById(actor)) : actor;
    const task = await this.lifecycle.requireTask(taskId);
    if (hasFullAccess(human)) {
      return task;
    }
    if (task.requestedByType === 'human' && task.requestedById === human.id) {
      return task;
    }
    if (
      task.conversationId &&
      (await this.conversationRepository.getMember(task.conversationId, {
        type: 'human',
        id: human.id
      }))
    ) {
      return task;
    }
    throw new AppError('taskNotFound', `Task ${taskId} was not found`);
  }

  private async requireAvailableAgent(agentId: string): Promise<Agent> {
    const agent = await this.agentRepository.getById(agentId);
    if (!agent) {
      throw new AppError('agentNotFound', `Agent ${agentId} was not found`);
    }
    if (agent.disabledAt || !agent.currentVersionId) {
      throw new AppError('agentUnavailable', `Agent ${agent.name} can't take new tasks`);
    }
    return agent;
  }
}

function humanActor(humanId: string): Actor {
  return { type: 'human', id: humanId };
}
