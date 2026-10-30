import {
  AgentRepository,
  ConversationRepository,
  CreateTaskInput,
  TaskRepository
} from '../../data';
import { Actor, Responsibility, Task } from '../../shared/types';
import { TaskLifecycle } from './task-lifecycle';

// Starts one run of a responsibility as a task. Used by the scheduler and by people starting a
// run by hand. runKey makes it safe to call twice for the same run: the second call finds the
// first task. Returns why no run was started, if one wasn't; openRunId is set when that's
// because the last run is still going.
export async function startResponsibilityRun(
  deps: {
    taskRepository: TaskRepository;
    agentRepository: AgentRepository;
    conversationRepository: ConversationRepository;
    lifecycle: TaskLifecycle;
  },
  responsibility: Responsibility,
  input: {
    runKey: string;
    startedBy: Actor;
    note?: string;
    expectedNextRunAt?: Date;
    catchUpSlot?: Date;
  }
): Promise<
  | { task: Task; created: boolean }
  | { skippedReason: string; openRunId?: string; catchUpNotPending?: boolean }
> {
  // A repeat of the same run returns it, even while it is still going.
  const existing = await deps.taskRepository.getByRunKey(input.runKey);
  if (existing && !input.catchUpSlot) {
    return { task: existing, created: false };
  }
  // One run at a time. A new run doesn't start while the last one is still open, so runs never
  // pile up or compete for the agent's messages in the conversation.
  const open = await deps.taskRepository.findOpenRun(responsibility.id);
  if (open && (!input.catchUpSlot || open.runKey !== input.runKey)) {
    return {
      skippedReason: `The previous run (task ${open.id}) is still ${open.state}.`,
      openRunId: open.id
    };
  }
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

  const taskInput: CreateTaskInput = {
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
  };
  const result = input.catchUpSlot
    ? await deps.taskRepository.resolveCatchUp({
        responsibilityId: responsibility.id,
        agentId: agent.id,
        slot: input.catchUpSlot,
        task: taskInput
      })
    : input.expectedNextRunAt
      ? await deps.taskRepository.createScheduled(taskInput, input.expectedNextRunAt)
      : await deps.taskRepository.create(taskInput);
  if (!result) {
    return {
      skippedReason: 'The schedule changed before this run could start.',
      catchUpNotPending: Boolean(input.catchUpSlot)
    };
  }
  if (!result.task)
    return { skippedReason: 'The agent is unavailable or its configuration changed. Try again.' };
  const { task, created } = result;
  // A different slot or manual request may have won the database's open-run constraint
  // after the check above. Return a skip instead of attributing that task to this slot.
  if (!created && task.runKey !== input.runKey) {
    return {
      skippedReason: `The previous run (task ${task.id}) is still ${task.state}.`,
      openRunId: task.id
    };
  }
  if (created) {
    await deps.lifecycle.recordCreated(task, input.startedBy);
  }
  return { task, created };
}
