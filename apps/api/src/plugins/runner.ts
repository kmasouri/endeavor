import { hostname } from 'node:os';
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import {
  AgentPostgresRepository,
  ApprovalPostgresRepository,
  TaskCapabilityPostgresRepository,
  CatalogPostgresRepository,
  ConversationPostgresRepository,
  ProjectPostgresRepository,
  CredentialCipher,
  ConnectionOAuthPostgresRepository,
  DocumentPostgresRepository,
  HumanPostgresRepository,
  MessagePostgresRepository,
  NotePostgresRepository,
  ResponsibilityPostgresRepository,
  TaskPostgresRepository
} from '../data';
import {
  ConnectionHttpClient,
  ConnectionOAuthHttpClient,
  McpHttpClient,
  createAnthropicProvider,
  ModelAiSdkClient,
  ModelClient,
  ModelScript,
  ModelScriptedClient,
  createOpenAiProvider,
  WorkspaceFsClient
} from '../integrations';
import { TaskLogger, TaskRunnerLogger } from '../observability';
import { AGENT_TOOLS, DEFAULT_RUNNER_OPTIONS, TaskRunnerService } from '../services';
import { ModelProvider } from '../shared/types';

declare module 'fastify' {
  interface FastifyInstance {
    taskRunnerService: TaskRunnerService;
  }
}

// What a 'scripted' agent does when no test gives it a script: it answers every request at once
// by echoing it. This lets you try the whole loop locally with no API key.
const echoScript: ModelScript = (request) => {
  const answered = request.transcript.some((entry) => entry.role === 'assistant');
  if (answered) {
    return { text: '' };
  }
  const first = request.transcript[0];
  const asked = first?.role === 'user' ? (first.text.split('Request:\n')[1] ?? first.text) : '';
  return {
    toolCalls: [
      {
        name: AGENT_TOOLS.completeTask,
        input: {
          result: `(scripted reply) I received: ${asked.split('\n')[0].slice(0, 200)}`,
          criteria_check: 'Scripted agents always reply once.',
          criteria_met: true
        }
      }
    ]
  };
};

function buildModelClients(settings: typeof config): Partial<Record<ModelProvider, ModelClient>> {
  return {
    ...(settings.ANTHROPIC_API_KEY && {
      anthropic: new ModelAiSdkClient(
        'anthropic',
        createAnthropicProvider(settings.ANTHROPIC_API_KEY)
      )
    }),
    ...(settings.OPENAI_API_KEY && {
      openai: new ModelAiSdkClient(
        'openai',
        createOpenAiProvider(settings.OPENAI_API_KEY, settings.OPENAI_BASE_URL)
      )
    }),
    scripted: new ModelScriptedClient(echoScript)
  };
}

// Builds the runner and, unless turned off, runs it every RUNNER_INTERVAL_MS while the server is
// up. The loop is in the backend, not the web interface: closing a browser changes nothing.
const runnerPlugin: FastifyPluginAsync = async (fastify) => {
  const runner = new TaskRunnerService(
    new TaskPostgresRepository(fastify.pg),
    new MessagePostgresRepository(fastify.pg),
    new ConversationPostgresRepository(fastify.pg),
    new ProjectPostgresRepository(fastify.pg),
    new AgentPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    new CatalogPostgresRepository(fastify.pg, new CredentialCipher(config.CREDENTIALS_KEY)),
    new ApprovalPostgresRepository(fastify.pg),
    new TaskCapabilityPostgresRepository(fastify.pg),
    new NotePostgresRepository(fastify.pg),
    new DocumentPostgresRepository(fastify.pg),
    new ResponsibilityPostgresRepository(fastify.pg),
    new ConnectionHttpClient(),
    new WorkspaceFsClient(config.WORKSPACES_DIR),
    buildModelClients(config),
    new TaskLogger(fastify.log),
    new TaskRunnerLogger(fastify.log),
    {
      ...DEFAULT_RUNNER_OPTIONS,
      workerId: `${hostname()}:${process.pid}`,
      completionCheck: config.COMPLETION_CHECK,
      prices: config.MODEL_PRICES,
      taskBudgetUsd: config.TASK_BUDGET_USD,
      modelTimeoutMs: config.MODEL_TIMEOUT_MS
    },
    new McpHttpClient(),
    new ConnectionOAuthPostgresRepository(fastify.pg, new CredentialCipher(config.CREDENTIALS_KEY)),
    new ConnectionOAuthHttpClient()
  );
  fastify.decorate('taskRunnerService', runner);

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let activeTick: Promise<void> | undefined;
  // Abort model requests while repositories are still available, then release their leases.
  fastify.addHook('preClose', async () => {
    stopped = true;
    clearTimeout(timer);
    runner.stop();
    await activeTick;
    await runner.drain();
  });
  if (!config.RUNNER_ENABLED) return;
  const logger = new TaskRunnerLogger(fastify.log);
  // Each tick starts after the last one ends, so ticks never overlap.
  const runTick = async () => {
    try {
      await runner.tick({ waitForTasks: false });
    } catch (error) {
      logger.onTickFailed(error);
    }
    if (!stopped) {
      timer = setTimeout(loop, config.RUNNER_INTERVAL_MS);
    }
  };
  const loop = () => {
    activeTick = runTick();
  };

  fastify.addHook('onReady', async () => {
    timer = setTimeout(loop, 0);
  });
};

export default fp(runnerPlugin, {
  name: 'runner',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
