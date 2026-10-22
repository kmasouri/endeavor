import { randomUUID } from 'node:crypto';
import {
  AgentRepository,
  CreateTaskOutputInput,
  CreateTaskWaitInput,
  HumanRepository,
  ListTasksInput,
  TaskChanges,
  TaskRepository
} from '../../data';
import { TaskLogger } from '../../observability';
import { requireHuman } from '../../shared/access';
import { AppError } from '../../shared/errors';
import { Actor, Agent, Task, TaskEvent, TaskOutput, TaskState, TaskWait } from '../../shared/types';
import { canTransition, isFinished } from './task-state';

export interface TaskDetails extends Task {
  waits: TaskWait[];
}

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
export class TaskService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly agentRepository: AgentRepository,
    private readonly humanRepository: HumanRepository,
    private readonly taskLogger: TaskLogger
  ) {}

  async createTask(
    actorId: string,
    input: CreateTaskRequest
  ): Promise<{ task: Task; created: boolean }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const agent = await this.requireAvailableAgent(input.ownerAgentId);

    const { task, created } = await this.taskRepository.create({
      runKey: input.runKey ? `client:${input.runKey}` : `human:${randomUUID()}`,
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
      await this.recordCreated(task, { type: 'human', id: human.id });
    }
    return { task, created };
  }

  async getTask(taskId: string): Promise<TaskDetails> {
    const task = await this.requireTask(taskId);
    const waits = await this.taskRepository.listWaits(task.id, { openOnly: false });
    return { ...task, waits };
  }

  async listTasks(input: ListTasksInput): Promise<{ tasks: Task[]; total: number }> {
    const filters = {
      state: input.state,
      ownerAgentId: input.ownerAgentId,
      conversationId: input.conversationId
    };
    const [tasks, total] = await Promise.all([
      this.taskRepository.list(input),
      this.taskRepository.count(filters)
    ]);
    return { tasks, total };
  }

  async listEvents(
    taskId: string,
    options: { afterId: number; limit: number }
  ): Promise<TaskEvent[]> {
    await this.requireTask(taskId);
    return this.taskRepository.listEvents(taskId, options);
  }

  async listOutputs(taskId: string): Promise<TaskOutput[]> {
    await this.requireTask(taskId);
    return this.taskRepository.listOutputs(taskId);
  }

  // Human actions

  async pauseTask(actorId: string, taskId: string, reason?: string): Promise<Task> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const task = await this.requireTask(taskId);
    if (isFinished(task) || task.pausedAt) {
      throw new AppError('taskStateConflict', `Task ${task.id} is ${describeState(task)}`);
    }

    const paused = await this.applyChanges(task, { pausedAt: new Date() });
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
    let task = await this.requireTask(taskId);
    if (!task.pausedAt && task.state !== 'blocked') {
      throw new AppError('taskStateConflict', `Task ${task.id} is ${describeState(task)}`);
    }

    if (task.pausedAt) {
      task = await this.applyChanges(task, { pausedAt: null });
    }
    if (task.state === 'blocked') {
      task = await this.transition(task, 'working', actor, { reason: note ?? null });
    }

    await this.taskRepository.addEvent(task.id, 'task.resumed', actor, { note: note ?? null });
    this.taskLogger.onTaskResumed(task.id);
    return task;
  }

  async cancelTask(actorId: string, taskId: string, reason?: string): Promise<Task> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const task = await this.requireTask(taskId);

    const cancelled = await this.transition(task, 'cancelled', humanActor(human.id), {
      reason: reason ?? null,
      changes: { pausedAt: null, finishedAt: new Date() }
    });
    await this.taskRepository.resolveOpenWaits(task.id, { cancelled: true });
    return cancelled;
  }

  // Restarting finished work creates a new linked task, so the old outcome stays as it was.
  // The new task uses the agent's current configuration. Each task can be restarted once;
  // to run it again, restart the newest one. Asking twice returns the same new task.
  async restartTask(actorId: string, taskId: string): Promise<{ task: Task; created: boolean }> {
    const human = requireHuman(await this.humanRepository.getById(actorId));
    const previous = await this.requireTask(taskId);
    if (!isFinished(previous)) {
      throw new AppError(
        'taskStateConflict',
        `Only completed or cancelled tasks can be restarted. Task ${previous.id} is ${describeState(previous)}`
      );
    }
    const agent = await this.requireAvailableAgent(previous.ownerAgentId);
    const actor = humanActor(human.id);

    const { task, created } = await this.taskRepository.create({
      runKey: `restart:${previous.id}`,
      conversationId: previous.conversationId,
      ownerAgentId: agent.id,
      agentVersionId: agent.currentVersionId as string,
      title: previous.title,
      brief: previous.brief,
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
      await this.recordCreated(task, actor);
      await this.taskRepository.addEvent(previous.id, 'task.restarted', actor, {
        newTaskId: task.id
      });
      this.taskLogger.onTaskRestarted(previous.id, task.id);
    }
    return { task, created };
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
    const task = await this.requireTask(taskId);
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
    await this.taskRepository.resolveWait(reviewWait.id, { review });
    await this.taskRepository.addEvent(task.id, 'task.reviewed', actor, { review });

    if (input.approved) {
      return this.transition(task, 'completed', actor, {
        changes: { review, finishedAt: new Date() }
      });
    }
    return this.transition(task, 'working', actor, {
      reason: `Review asked for changes${input.notes ? `: ${input.notes}` : ''}`,
      changes: { review }
    });
  }

  // Lifecycle actions, used by the runner for the agent that owns the task

  async waitFor(taskId: string, actor: Actor, waits: CreateTaskWaitInput[]): Promise<TaskDetails> {
    const task = await this.requireTask(taskId);
    if (waits.length === 0 || !canTransition(task.state, 'waiting')) {
      throw new AppError('taskStateConflict', `Task ${task.id} can't wait while ${task.state}`);
    }

    // Save the waits first. If the state change then loses a race, close them again so they
    // don't wake anything later.
    const created = await this.taskRepository.addWaits(task.id, waits);
    try {
      const waiting = await this.transition(task, 'waiting', actor, {
        reason: created.map((wait) => wait.description).join('; ')
      });
      return { ...waiting, waits: created };
    } catch (error) {
      for (const wait of created) {
        await this.taskRepository.resolveWait(wait.id, { abandoned: true });
      }
      throw error;
    }
  }

  // Resolves one wait. When none are left open, the task goes back to working.
  async resolveWait(
    waitId: string,
    actor: Actor,
    resolution: Record<string, unknown>
  ): Promise<Task> {
    const wait = await this.taskRepository.resolveWait(waitId, resolution);
    if (!wait) {
      throw new AppError('taskWaitNotFound', `Wait ${waitId} is not open`);
    }

    const task = await this.requireTask(wait.taskId);
    await this.taskRepository.addEvent(task.id, 'task.wait.resolved', actor, {
      waitId: wait.id,
      kind: wait.kind,
      resolution
    });

    const open = await this.taskRepository.listWaits(task.id, { openOnly: true });
    if (open.length > 0 || task.state !== 'waiting') {
      return task;
    }
    return this.transition(task, 'working', actor, { reason: null });
  }

  async addOutput(taskId: string, actor: Actor, input: CreateTaskOutputInput): Promise<TaskOutput> {
    const task = await this.requireTask(taskId);
    if (isFinished(task)) {
      throw new AppError('taskStateConflict', `Task ${task.id} is already ${task.state}`);
    }

    const output = await this.taskRepository.addOutput(task.id, input);
    await this.taskRepository.addEvent(task.id, 'task.output.added', actor, {
      outputId: output.id,
      kind: output.kind,
      title: output.title
    });
    return output;
  }

  // Completion needs at least one output and a check against the completion criteria. The
  // agent saying it is done is not enough. If the task needs review, it waits for a human
  // instead of completing.
  async completeTask(
    taskId: string,
    actor: Actor,
    check: { met: boolean; summary: string }
  ): Promise<Task> {
    const task = await this.requireTask(taskId);
    if (task.state !== 'working') {
      throw new AppError('taskStateConflict', `Task ${task.id} can't complete while ${task.state}`);
    }

    if ((await this.taskRepository.countOutputs(task.id)) === 0) {
      return this.rejectCompletion(task, 'The task has no output yet');
    }
    if (!check.met) {
      return this.rejectCompletion(task, `The completion criteria are not met: ${check.summary}`);
    }

    const criteriaCheck = {
      met: true,
      summary: check.summary,
      checkedBy: actor,
      checkedAt: new Date()
    };
    if (task.reviewRequired) {
      const checked = await this.applyChanges(task, { criteriaCheck });
      await this.waitFor(checked.id, actor, [
        {
          kind: 'approval',
          targetId: task.id,
          description: 'A human reviews the output against the completion criteria'
        }
      ]);
      return this.requireTask(task.id);
    }

    return this.transition(task, 'completed', actor, {
      changes: { criteriaCheck, finishedAt: new Date() }
    });
  }

  async blockTask(taskId: string, actor: Actor, reason: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    return this.transition(task, 'blocked', actor, { reason });
  }

  // Helpers

  private async rejectCompletion(task: Task, reason: string): Promise<never> {
    this.taskLogger.onTaskCompletionRejected(task.id, reason);
    throw new AppError('taskCompletionRejected', reason);
  }

  private async transition(
    task: Task,
    to: TaskState,
    actor: Actor,
    options: { reason?: string | null; changes?: TaskChanges } = {}
  ): Promise<Task> {
    if (!canTransition(task.state, to)) {
      throw new AppError(
        'taskStateConflict',
        `Task ${task.id} can't go from ${task.state} to ${to}`
      );
    }

    const updated = await this.applyChanges(task, {
      ...options.changes,
      state: to,
      ...(options.reason !== undefined && { stateReason: options.reason })
    });
    await this.taskRepository.addEvent(task.id, 'task.state.changed', actor, {
      from: task.state,
      to,
      reason: options.reason ?? null
    });
    this.taskLogger.onTaskStateChanged(task.id, task.state, to);
    return updated;
  }

  // Writes the changes only if nobody changed the task since it was read.
  private async applyChanges(task: Task, changes: TaskChanges): Promise<Task> {
    const updated = await this.taskRepository.update(
      task.id,
      { state: task.state, paused: task.pausedAt !== null },
      changes
    );
    if (!updated) {
      throw new AppError(
        'taskStateConflict',
        `Task ${task.id} changed at the same time. Try again`
      );
    }
    return updated;
  }

  private async recordCreated(task: Task, actor: Actor): Promise<void> {
    await this.taskRepository.addEvent(task.id, 'task.created', actor, {
      agentVersionId: task.agentVersionId,
      restartedFromTaskId: task.restartedFromTaskId
    });
    this.taskLogger.onTaskCreated(task.id, task.ownerAgentId);
  }

  private async requireTask(taskId: string): Promise<Task> {
    const task = await this.taskRepository.getById(taskId);
    if (!task) {
      throw new AppError('taskNotFound', `Task ${taskId} was not found`);
    }
    return task;
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

function describeState(task: Task): string {
  return task.pausedAt ? `${task.state} and paused` : task.state;
}
