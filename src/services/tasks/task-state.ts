import { Task, TaskState } from '../../shared/types';

// The allowed state changes. Completed and cancelled are final: to run that work again,
// restart it, which creates a new linked task.
//
//   working   -> waiting, completed, blocked, cancelled
//   waiting   -> working (its waits are resolved), completed (a human approved its review),
//                blocked, cancelled
//   blocked   -> working (a human resumes it), cancelled
//
// Pause is not a state. A paused task keeps its state, and the runner skips it until a human
// resumes it. Only open tasks (working, waiting, blocked) can be paused.
const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  working: ['waiting', 'completed', 'blocked', 'cancelled'],
  waiting: ['working', 'completed', 'blocked', 'cancelled'],
  blocked: ['working', 'cancelled'],
  completed: [],
  cancelled: []
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinished(task: Pick<Task, 'state'>): boolean {
  return task.state === 'completed' || task.state === 'cancelled';
}
