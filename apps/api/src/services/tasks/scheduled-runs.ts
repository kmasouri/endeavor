import { TaskRepository } from '../../data';
import { AppError } from '../../shared/errors';
import { canonicalConversationName, MAX_CONVERSATION_NAME_LENGTH } from '../../shared/conversation-name';
import { Actor, Responsibility } from '../../shared/types';
import { TaskLifecycle } from './task-lifecycle';

export async function startResponsibilityRun(
  taskRepository: TaskRepository,
  lifecycle: TaskLifecycle,
  responsibility: Responsibility,
  input: {
    runKey: string;
    startedBy: Actor;
    note?: string;
    expectedNextRunAt?: Date;
    catchUpSlot?: Date;
  }
) {
  const name = canonicalConversationName(responsibility.title)
    .slice(0, MAX_CONVERSATION_NAME_LENGTH)
    .replace(/-$/, '');
  const result = await taskRepository.startResponsibilityRun({
    ...input,
    responsibilityId: responsibility.id,
    projectId: responsibility.projectId,
    agentId: responsibility.agentId,
    endeavorTitle: name || 'scheduled-run',
    title: responsibility.title,
    goal: responsibility.brief,
    completionCriteria: responsibility.completionCriteria,
    expectedUpdatedAt: responsibility.updatedAt
  });
  if ('run' in result && result.created && result.task) {
    await lifecycle.recordCreated(result.task, input.startedBy);
  }
  return result;
}

export function responsibilityRunError(reason: 'open' | 'changed' | 'agent' | 'project'): AppError {
  switch (reason) {
    case 'open':
      return new AppError('responsibilityRunOpen', 'The previous run is still open.');
    case 'project':
      return new AppError('projectArchived', 'The schedule project is archived.');
    case 'agent':
      return new AppError('agentUnavailable', 'The pinned agent cannot start a run.');
    case 'changed':
      return new AppError('responsibilityRunChanged');
  }
}
