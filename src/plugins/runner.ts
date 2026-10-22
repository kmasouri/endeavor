import { hostname } from 'node:os';
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import {
  AgentPostgresRepository,
  ApprovalPostgresRepository,
  CatalogPostgresRepository,
  ConversationPostgresRepository,
  CredentialCipher,
  HumanPostgresRepository,
  MessagePostgresRepository,
  TaskPostgresRepository
} from '../data';
import {
  ConnectionHttpClient,
  ModelAnthropicClient,
  ModelClient,
  ModelOpenAIClient,
  ModelScript,
  ModelScriptedClient
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
export const echoScript: ModelScript = (request) => {
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

export function buildModelClients(
  settings: typeof config
): Partial<Record<ModelProvider, ModelClient>> {
  return {
    ...(settings.ANTHROPIC_API_KEY && {
      anthropic: new ModelAnthropicClient(settings.ANTHROPIC_API_KEY)
    }),
    ...(settings.OPENAI_API_KEY && {
      openai: new ModelOpenAIClient(settings.OPENAI_API_KEY, settings.OPENAI_BASE_URL)
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
    new AgentPostgresRepository(fastify.pg),
    new HumanPostgresRepository(fastify.pg),
    new CatalogPostgresRepository(fastify.pg, new CredentialCipher(config.CREDENTIALS_KEY)),
    new ApprovalPostgresRepository(fastify.pg),
    new ConnectionHttpClient(),
    buildModelClients(config),
    new TaskLogger(fastify.log),
    new TaskRunnerLogger(fastify.log),
    { ...DEFAULT_RUNNER_OPTIONS, workerId: `${hostname()}:${process.pid}` }
  );
  fastify.decorate('taskRunnerService', runner);

  if (!config.RUNNER_ENABLED) {
    return;
  }

  const logger = new TaskRunnerLogger(fastify.log);
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  // Each tick starts after the last one ends, so ticks never overlap.
  const loop = async () => {
    try {
      await runner.tick();
    } catch (error) {
      logger.onTickFailed(error);
    }
    if (!stopped) {
      timer = setTimeout(loop, config.RUNNER_INTERVAL_MS);
    }
  };

  fastify.addHook('onReady', async () => {
    timer = setTimeout(loop, 0);
  });
  fastify.addHook('onClose', async () => {
    stopped = true;
    clearTimeout(timer);
  });
};

export default fp(runnerPlugin, {
  name: 'runner',
  dependencies: ['@fastify/postgres', '@fastify/request-context']
});
