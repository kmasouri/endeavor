import { TaskOutput, TaskOutputView, TaskState } from '../../shared/types';

// An output becomes final with its task. Cancelled, blocked, waiting, and active work stays draft.
export function describeOutputState(output: TaskOutput, taskState: TaskState): TaskOutputView {
  return { ...output, state: taskState === 'completed' ? 'final' : 'draft' };
}
