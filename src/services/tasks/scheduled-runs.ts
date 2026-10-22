import { AgentRepository, ConversationRepository, TaskRepository } from '../../data';
import { Actor, Responsibility, Task } from '../../shared/types';
import { TaskLifecycle } from './task-lifecycle';

// Starts one run of a responsibility as a task. Used by the scheduler and by people starting a
// run by hand. runKey makes it safe to call twice for the same run: the second call finds the
// first task. Returns why no run was started, if one wasn't.
export async function startResponsibilityRun(
  deps: {
    taskRepository: TaskRepository;
    agentRepository: AgentRepository;
    conversationRepository: ConversationRepository;
    lifecycle: TaskLifecycle;
  },
  responsibility: Responsibility,
  input: { runKey: string; startedBy: Actor; note?: string }
): Promise<{ task: Task; created: boolean } | { skippedReason: string }> {
  const agent = await deps.agentRepository.getById(responsibility.agentId);
  if (!agent || agent.disabledAt || !agent.currentVersionId) {
    return { skippedReason: 'The agent is disabled or has no configuration.' };
  }
  if (
    responsibility.conversationId &&
    !(await deps.conversationRepository.getMember(responsibility.conversationId, {
      type: 'agent',
      id: agent.id
    }))
  ) {
    return { skippedReason: 'The agent is no longer a member of the conversation.' };
  }

  const { task, created } = await deps.taskRepository.create({
    runKey: input.runKey,
    conversationId: responsibility.conversationId,
    ownerAgentId: agent.id,
    agentVersionId: agent.currentVersionId,
    title: responsibility.title,
    brief: input.note ? `${responsibility.brief}\n\n${input.note}` : responsibility.brief,
    completionCriteria: responsibility.completionCriteria,
    reviewRequired: false,
    requestedByType: input.startedBy.type === 'human' ? 'human' : 'schedule',
    requestedById: input.startedBy.type === 'human' ? input.startedBy.id : null,
    requestMessageId: null,
    parentTaskId: null,
    restartedFromTaskId: null,
    responsibilityId: responsibility.id
  });
  if (created) {
    await deps.lifecycle.recordCreated(task, input.startedBy);
  }
  return { task, created };
}
