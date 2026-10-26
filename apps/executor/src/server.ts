import { OperationError } from './errors.ts';
import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import type { ExecutionService } from './execution.service.ts';
import { TOOLS, toolSchemas, type ToolName } from './schemas.ts';

const rpcSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional()
});
const callSchema = z.object({
  name: z.enum(Object.keys(toolSchemas) as [ToolName, ...ToolName[]]),
  arguments: z.unknown().optional()
});

export function buildServer(service: ExecutionService, token: string) {
  const app = Fastify({ logger: false, bodyLimit: 1_500_000 });
  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/mcp', async (request, reply) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return reply.code(401).send();
    const parsed = rpcSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid MCP request' });
    const message = parsed.data;
    if (message.id === undefined) return reply.code(202).send();
    let result: unknown;
    if (message.method === 'initialize')
      result = {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'endeavor-executor', version: '0.1.0' }
      };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: TOOLS };
    else if (message.method === 'tools/call') {
      try {
        const task = z.uuid().parse(request.headers['x-endeavor-task-id']);
        const input = callSchema.parse(message.params);
        const output = await service.call(task, input.name, input.arguments ?? {});
        result = { content: [{ type: 'text', text: JSON.stringify(output) }] };
      } catch (error) {
        // Only our own validation and operation errors are returned; no provider response,
        // filesystem location, Docker diagnostics, or broker credential is model-visible.
        result = {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error instanceof z.ZodError
                  ? 'Invalid tool arguments or missing trusted task identity.'
                  : error instanceof OperationError
                    ? error.message
                    : 'Operation failed; check executor availability and storage.'
            }
          ]
        };
      }
    } else
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not found' }
      };
    return { jsonrpc: '2.0', id: message.id, result };
  });
  return app;
}
