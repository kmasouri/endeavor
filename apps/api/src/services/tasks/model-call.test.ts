import { getEventListeners } from 'node:events';
import { mockTaskRepository } from '../../data/repositories.test-helper';
import {
  ModelClient,
  ModelClientError,
  ModelTurnRequest,
  ModelTurnResult
} from '../../integrations';
import { AgentVersion, Task } from '../../shared/types';
import { callTaskModel, ModelCallStoppedError } from './model-call';

const result: ModelTurnResult = {
  text: 'Done',
  toolCalls: [],
  stopReason: 'end',
  raw: {},
  usage: { inputTokens: 1, outputTokens: 1 },
  servedModel: 'test'
};

function setup() {
  const task = {
    id: 'task',
    agentVersionId: 'version',
    state: 'working',
    pausedAt: null,
    pausedByHumanId: null,
    createdAt: new Date()
  } as Task;
  const version = { id: 'version', provider: 'scripted', limits: {} } as AgentVersion;
  const repository = mockTaskRepository();
  repository.getById.mockResolvedValue(task);
  const complete = jest.fn<Promise<ModelTurnResult>, [ModelTurnRequest]>(
    () => new Promise(() => {})
  );
  const client: ModelClient = { provider: 'scripted', transcriptFormat: 'native', complete };
  const shutdown = new AbortController();
  const input = {
    repository,
    task,
    version,
    client,
    events: [],
    request: { model: 'test', system: '', transcript: [], tools: [], maxTokens: 10 },
    workerId: 'worker',
    leaseMs: 3000,
    timeoutMs: 2000,
    shutdownSignal: shutdown.signal
  };
  return { input, repository, task, version, complete, shutdown };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('bounds a client that ignores cancellation and removes timers/listeners', async () => {
  const { input, complete, shutdown } = setup();
  const outcome = callTaskModel(input).catch((error) => error);
  await jest.advanceTimersByTimeAsync(2001);
  const error = await outcome;
  expect(error).toBeInstanceOf(ModelClientError);
  expect(error.retryable).toBe(true);
  expect(complete.mock.calls[0][0].signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  expect(getEventListeners(shutdown.signal, 'abort')).toHaveLength(0);
});

it.each(['paused', 'cancelled', 'migrated', 'lease lost', 'repository failed'])(
  'aborts without a provider failure when %s',
  async (reason) => {
    const { input, repository, task, complete } = setup();
    input.timeoutMs = 10_000;
    const outcome = callTaskModel(input).catch((error) => error);
    if (reason === 'paused')
      repository.getById.mockResolvedValue({ ...task, pausedAt: new Date() });
    if (reason === 'cancelled')
      repository.getById.mockResolvedValue({ ...task, state: 'cancelled' });
    if (reason === 'migrated')
      repository.getById.mockResolvedValue({ ...task, agentVersionId: 'new' });
    if (reason === 'lease lost') repository.renewLease.mockResolvedValue(false);
    if (reason === 'repository failed')
      repository.getById.mockRejectedValue(new Error('DB unavailable'));
    await jest.advanceTimersByTimeAsync(1001);
    expect(await outcome).toBeInstanceOf(ModelCallStoppedError);
    expect(complete.mock.calls[0][0].signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  }
);

it('aborts immediately on shutdown, even when the provider never settles', async () => {
  const { input, shutdown, complete } = setup();
  const outcome = callTaskModel(input).catch((error) => error);
  shutdown.abort();
  expect(await outcome).toBeInstanceOf(ModelCallStoppedError);
  expect(complete.mock.calls[0][0].signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not contact the provider after shutdown', async () => {
  const { input, shutdown, complete } = setup();
  shutdown.abort();
  await expect(callTaskModel(input)).rejects.toBeInstanceOf(ModelCallStoppedError);
  expect(complete).not.toHaveBeenCalled();
});

it('honors a pause when the deadline fires before the next control poll', async () => {
  const { input, repository, task } = setup();
  input.timeoutMs = 50;
  const outcome = callTaskModel(input).catch((error) => error);
  repository.getById.mockResolvedValue({ ...task, pausedAt: new Date() });
  await jest.advanceTimersByTimeAsync(51);
  expect(await outcome).toBeInstanceOf(ModelCallStoppedError);
});

it('uses the remaining task working-time budget as a non-retryable deadline', async () => {
  const { input, task, version } = setup();
  version.limits.maxWorkingMinutes = 1;
  task.createdAt = new Date(Date.now() - 59_950);
  const outcome = callTaskModel(input).catch((error) => error);
  await jest.advanceTimersByTimeAsync(51);
  const error = await outcome;
  expect(error).toBeInstanceOf(ModelClientError);
  expect(error.retryable).toBe(false);
  expect(error.message).toContain('working-time limit');
});

it('discards a result when control changes just before the provider responds', async () => {
  const { input, complete, repository, task } = setup();
  complete.mockImplementation(async () => {
    repository.getById.mockResolvedValue({ ...task, state: 'cancelled' });
    return result;
  });
  await expect(callTaskModel(input)).rejects.toBeInstanceOf(ModelCallStoppedError);
  expect(jest.getTimerCount()).toBe(0);
});

it('cleans up after success and an immediate provider error', async () => {
  const { input, complete, shutdown } = setup();
  complete.mockResolvedValueOnce(result);
  expect(await callTaskModel(input)).toBe(result);
  complete.mockRejectedValueOnce(new ModelClientError('Unavailable', 'scripted', true));
  await expect(callTaskModel(input)).rejects.toBeInstanceOf(ModelClientError);
  expect(jest.getTimerCount()).toBe(0);
  expect(getEventListeners(shutdown.signal, 'abort')).toHaveLength(0);
});
