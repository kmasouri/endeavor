import {
  CreateTaskOutputInput,
  CreateTaskWaitInput,
  TaskChanges,
  TaskRepository
} from '../../data';
import { TaskLogger } from '../../observability';
import { AppError } from '../../shared/errors';
import { Actor, Task, TaskOutput, TaskState, TaskWait } from '../../shared/types';
import { canTransition, isFinished } from './task-state';

export interface TaskDetails extends Task {
  waits: TaskWait[];
}

// The task lifecycle rules, shared by TaskService (human actions and the API) and
// TaskRunnerService (the runner, acting for agents). It is a helper inside the tasks feature,
// not a service, so the two services share it without using each other.
export class TaskLifecycle {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskLogger: TaskLogger
  ) {}

  async waitFor(taskId: string, actor: Actor, waits: CreateTaskWaitInput[]): Promise<TaskDetails> {
    const task = await this.requireTask(taskId);
    if (waits.length === 0 || task.pausedAt || !canTransition(task.state, 'waiting')) {
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

    await this.taskRepository.addEvent(wait.taskId, 'task.wait.resolved', actor, {
      waitId: wait.id,
      kind: wait.kind,
      resolution
    });
    return this.wakeIfReady(wait.taskId, actor);
  }

  // Moves a waiting task with no open waits back to working. Retries when another change gets
  // there first, such as a pause, so a resolved wait never leaves a task stuck. The runner also
  // calls this to repair any task that was left that way by a crash.
  async wakeIfReady(taskId: string, actor: Actor): Promise<Task> {
    for (let attempt = 1; ; attempt++) {
      const task = await this.requireTask(taskId);
      const open = await this.taskRepository.listWaits(task.id, { openOnly: true });
      if (task.state !== 'waiting' || open.length > 0) {
        return task;
      }
      try {
        return await this.transition(task, 'working', actor, { reason: null });
      } catch (error) {
        if (attempt >= 3 || !(error instanceof AppError) || error.name !== 'taskStateConflict') {
          throw error;
        }
      }
    }
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
    if (task.state !== 'working' || task.pausedAt) {
      throw new AppError(
        'taskStateConflict',
        `Task ${task.id} can't complete while ${describeState(task)}`
      );
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

  private async rejectCompletion(task: Task, reason: string): Promise<never> {
    this.taskLogger.onTaskCompletionRejected(task.id, reason);
    throw new AppError('taskCompletionRejected', reason);
  }

  async transition(
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
  async applyChanges(task: Task, changes: TaskChanges): Promise<Task> {
    const updated = await this.taskRepository.update(
      task.id,
      { state: task.state, paused: task.pausedAt !== null, agentVersionId: task.agentVersionId },
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

  async recordCreated(task: Task, actor: Actor): Promise<void> {
    await this.taskRepository.addEvent(task.id, 'task.created', actor, {
      agentVersionId: task.agentVersionId,
      restartedFromTaskId: task.restartedFromTaskId
    });
    this.taskLogger.onTaskCreated(task.id, task.ownerAgentId);
  }

  async requireTask(taskId: string): Promise<Task> {
    const task = await this.taskRepository.getById(taskId);
    if (!task) {
      throw new AppError('taskNotFound', `Task ${taskId} was not found`);
    }
    return task;
  }
}

export function describeState(task: Task): string {
  return task.pausedAt ? `${task.state} and paused` : task.state;
}
