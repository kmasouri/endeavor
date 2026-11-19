import { TaskRepository } from '../../data';
import {
  ModelClient,
  ModelClientError,
  ModelTurnRequest,
  ModelTurnResult
} from '../../integrations';
import { AppError } from '../../shared/errors';
import { AgentVersion, Task, TaskEvent } from '../../shared/types';
import { measureWorkingMs } from './task-budget';

// Control changes stop work without consuming a provider retry or recording a stale result.
export class ModelCallStoppedError extends AppError {
  constructor() {
    super('taskStateConflict', 'The model call stopped because task control or ownership changed.');
  }
}

// The abort signal asks the provider to stop. The race also bounds clients that ignore it.
export async function callTaskModel(input: {
  repository: TaskRepository;
  task: Task;
  version: AgentVersion;
  events: TaskEvent[];
  client: ModelClient;
  request: ModelTurnRequest;
  workerId: string;
  leaseMs: number;
  timeoutMs: number;
  shutdownSignal: AbortSignal;
}): Promise<ModelTurnResult> {
  const { task, version, repository } = input;
  const controller = new AbortController();
  const remaining =
    version.limits.maxWorkingMinutes === undefined
      ? Infinity
      : version.limits.maxWorkingMinutes * 60_000 -
        measureWorkingMs(task, input.events, new Date());
  const budgetLimited = remaining <= input.timeoutMs;
  const timeoutError = () =>
    new ModelClientError(
      budgetLimited
        ? 'The task reached its working-time limit while waiting for the model.'
        : `The model request timed out after ${input.timeoutMs} milliseconds.`,
      version.provider,
      !budgetLimited
    );
  if (input.shutdownSignal.aborted) throw new ModelCallStoppedError();
  if (remaining <= 0) throw timeoutError();

  let finished = false;
  let rejectStopped: (reason: Error) => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject;
  });
  const abort = (reason: Error) => {
    if (finished || controller.signal.aborted) return;
    rejectStopped(reason);
    controller.abort(reason);
  };
  const onShutdown = () => abort(new ModelCallStoppedError());
  input.shutdownSignal.addEventListener('abort', onShutdown, { once: true });
  const deadline = setTimeout(
    () => abort(timeoutError()),
    Math.max(1, Math.min(input.timeoutMs, remaining))
  );
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const stillAllowed = async () => {
    const current = await repository.getById(task.id);
    if (
      !current ||
      current.state !== 'working' ||
      current.pausedAt ||
      current.agentVersionId !== version.id
    )
      return false;
    return repository.renewLease(task.id, input.workerId, input.leaseMs);
  };
  const poll = async () => {
    try {
      if (!(await stillAllowed())) abort(new ModelCallStoppedError());
    } catch {
      abort(new ModelCallStoppedError());
    }
    if (!finished && !controller.signal.aborted) {
      pollTimer = setTimeout(
        () => {
          void poll();
        },
        Math.max(1, Math.min(1000, input.leaseMs / 3))
      );
    }
  };
  pollTimer = setTimeout(
    () => {
      void poll();
    },
    Math.max(1, Math.min(1000, input.leaseMs / 3))
  );
  try {
    const result = await Promise.race([
      input.client.complete({ ...input.request, signal: controller.signal }),
      stopped
    ]);
    if (controller.signal.aborted || input.shutdownSignal.aborted || !(await stillAllowed())) {
      throw new ModelCallStoppedError();
    }
    return result;
  } catch (error) {
    if (error instanceof ModelClientError) {
      // A deadline can fire before the next control poll. A pause or lost lease must still
      // take precedence over recording a provider failure for a task we no longer own.
      let allowed = false;
      try {
        allowed = !input.shutdownSignal.aborted && (await stillAllowed());
      } catch {
        /* Stop on lost database access. */
      }
      if (!allowed) throw new ModelCallStoppedError();
    }
    throw error;
  } finally {
    finished = true;
    clearTimeout(deadline);
    clearTimeout(pollTimer);
    input.shutdownSignal.removeEventListener('abort', onShutdown);
  }
}
