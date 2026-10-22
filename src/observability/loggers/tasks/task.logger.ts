import { FastifyBaseLogger } from 'fastify';
import { TaskState } from '../../../shared/types';
import { currentLogger } from '../request-logger';

export class TaskLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onTaskCreated(taskId: string, agentId: string): void {
    currentLogger(this.logger).info({ event: 'task.created', taskId, agentId }, 'task created');
  }

  onTaskStateChanged(taskId: string, from: TaskState, to: TaskState): void {
    currentLogger(this.logger).info(
      { event: 'task.state.changed', taskId, from, to },
      'task state changed'
    );
  }

  onTaskPaused(taskId: string): void {
    currentLogger(this.logger).info({ event: 'task.paused', taskId }, 'task paused');
  }

  onTaskResumed(taskId: string): void {
    currentLogger(this.logger).info({ event: 'task.resumed', taskId }, 'task resumed');
  }

  onTaskRestarted(taskId: string, newTaskId: string): void {
    currentLogger(this.logger).info(
      { event: 'task.restarted', taskId, newTaskId },
      'task restarted as a new run'
    );
  }

  onTaskVersionMigrated(taskId: string, fromVersionId: string, toVersionId: string): void {
    currentLogger(this.logger).info(
      { event: 'task.version.migrated', taskId, fromVersionId, toVersionId },
      'task moved to another configuration version'
    );
  }

  onTaskCompletionRejected(taskId: string, reason: string): void {
    currentLogger(this.logger).info(
      { event: 'task.completion.rejected', taskId, reason },
      'task completion rejected'
    );
  }
}
