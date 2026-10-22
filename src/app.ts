import { randomUUID } from 'node:crypto';
import postgres from '@fastify/postgres';
import fastifyRequestContext from '@fastify/request-context';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler
} from '@fastify/type-provider-zod';
import fastify, { FastifyInstance, FastifyReply, FastifySchemaValidationError } from 'fastify';
import { config } from './config';
import agentPlugin from './plugins/agent';
import catalogPlugin from './plugins/catalog';
import conversationPlugin from './plugins/conversation';
import humanPlugin from './plugins/human';
import itemPlugin from './plugins/item';
import notePlugin from './plugins/note';
import runnerPlugin from './plugins/runner';
import taskPlugin from './plugins/task';
import { AppError, ErrorName, ERRORS } from './shared/errors';
import { ErrorDetail, failure } from './shared/response';
import * as routes from './routes';

interface RequestValidationError {
  validation: FastifySchemaValidationError[];
  validationContext?: string;
}

function isValidationError(error: unknown): error is RequestValidationError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    Array.isArray(error.validation)
  );
}

// Turns Zod's issues into one entry per bad field, such as
// { field: 'name', in: 'body', message: 'Invalid input: expected string, received undefined' }.
function toErrorDetails(error: RequestValidationError): ErrorDetail[] {
  const location = error.validationContext ?? 'request';

  return error.validation.flatMap((issue) => {
    const path = issue.instancePath.split('/').filter(Boolean);

    // z.strictObject reports all unknown fields in one issue. Split them up.
    if (issue.keyword === 'unrecognized_keys' && Array.isArray(issue.params.keys)) {
      return issue.params.keys.map((key) => ({
        field: [...path, String(key)].join('.'),
        in: location,
        message: 'Unknown field'
      }));
    }

    return [
      {
        field: path.length > 0 ? path.join('.') : undefined,
        in: location,
        message: issue.message ?? 'Invalid value'
      }
    ];
  });
}

// Fastify gives its own request errors (bad JSON, wrong content type, body too large) a 4xx
// status code. Returns that status, or undefined for anything else.
function getClientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return undefined;
  }

  const { statusCode } = error;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
}

// Picks the catalog error for a Fastify request error by its status.
function toClientErrorName(statusCode: number): ErrorName {
  if (statusCode === 413) {
    return 'payloadTooLarge';
  }
  if (statusCode === 415) {
    return 'unsupportedMediaType';
  }
  return 'invalidRequest';
}

// Every error response goes through here, so they all look the same. See docs/responses.md.
function sendError(
  reply: FastifyReply,
  name: ErrorName,
  options: { message?: string; details?: ErrorDetail[]; statusCode?: number } = {}
): FastifyReply {
  const definition = ERRORS[name];
  return reply.code(options.statusCode ?? definition.statusCode).send(
    failure({
      code: definition.code,
      name,
      message: options.message ?? definition.message,
      requestId: reply.request.id,
      ...(options.details && { details: options.details })
    })
  );
}

export function setupApp(): FastifyInstance {
  const app = fastify({
    logger: {
      level: config.LOGGER_LEVEL,
      // Readable, colored logs when running locally. Everywhere else, logs stay JSON so log
      // tools can search their fields. pino-pretty is a dev dependency, so it is not in the image.
      ...(config.ENVIRONMENT === 'local' && { transport: { target: 'pino-pretty' } })
    },
    requestIdHeader: config.REQUEST_ID_HEADER,
    genReqId: () => randomUUID()
  });

  // Route schemas are Zod schemas. Zod validates requests (and responses, when a route declares a
  // response schema) instead of Fastify's default Ajv compiler.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Fastify resolves request.id from the configured incoming header, or generates
  // one with genReqId when the header is missing. This only reflects that final
  // ID back to the caller for cross-service debugging.
  app.addHook('onRequest', async (request, reply) => {
    reply.header(config.REQUEST_ID_HEADER, request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    if (isValidationError(error)) {
      return sendError(reply, 'validationError', { details: toErrorDetails(error) });
    }

    if (error instanceof AppError) {
      return sendError(reply, error.name, { message: error.message });
    }

    const clientErrorStatus = getClientErrorStatus(error);
    if (clientErrorStatus !== undefined) {
      return sendError(reply, toClientErrorName(clientErrorStatus), {
        message: (error as Error).message,
        statusCode: clientErrorStatus
      });
    }

    // request.log adds the request ID to the log line.
    request.log.error(error);
    return sendError(reply, 'internalError');
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, 'routeNotFound', {
      message: `Route ${request.method} ${request.url} not found`
    })
  );

  // Remembers each request's logger while the request runs, so services can log with its
  // request ID without being passed the request. See src/observability/loggers/request-logger.ts.
  app.register(fastifyRequestContext, {
    defaultStoreValues: (request) => ({ log: request.log })
  });

  app.register(postgres, config.DATABASE);

  app.register(swagger, {
    openapi: {
      info: {
        title: 'Bold Cedar 007 API',
        version: '0.1.0'
      }
    },
    // Converts Zod route schemas into JSON Schema for the OpenAPI document.
    transform: jsonSchemaTransform
  });

  app.register(swaggerUi, {
    routePrefix: '/docs'
  });

  app.register(agentPlugin);
  app.register(catalogPlugin);
  app.register(conversationPlugin);
  app.register(humanPlugin);
  app.register(itemPlugin);
  app.register(notePlugin);
  app.register(taskPlugin);
  app.register(runnerPlugin);

  app.register(routes.agentsRouter);
  app.register(routes.catalogsRouter);
  app.register(routes.conversationsRouter);
  app.register(routes.healthcheckRouter);
  app.register(routes.humansRouter);
  app.register(routes.itemsRouter);
  app.register(routes.notesRouter);
  app.register(routes.tasksRouter);

  return app;
}
