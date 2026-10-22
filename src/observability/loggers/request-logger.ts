import { requestContext } from '@fastify/request-context';
import { FastifyBaseLogger } from 'fastify';

declare module '@fastify/request-context' {
  interface RequestContextData {
    log: FastifyBaseLogger;
  }
}

// Returns the logger of the request that is running right now, so log lines get its request ID.
// Outside a request (startup, background jobs) it returns the fallback logger.
export function currentLogger(fallback: FastifyBaseLogger): FastifyBaseLogger {
  return requestContext.get('log') ?? fallback;
}
