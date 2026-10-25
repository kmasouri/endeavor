import {
  Client,
  StreamableHTTPClientTransport,
  type JsonSchemaType
} from '@modelcontextprotocol/client';
import { z } from 'zod';
import { McpClient, McpEndpoint, McpResult, McpTool } from './mcp.client';

const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_RESULT_CHARS = 20_000;

// Use the same validator as the rest of the platform, including SDK output schemas.
const validator = {
  getValidator<T>(schema: JsonSchemaType) {
    const parsed = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
    return (input: unknown) => {
      const result = parsed.safeParse(input);
      return result.success
        ? { valid: true as const, data: result.data as T, errorMessage: undefined }
        : { valid: false as const, data: undefined, errorMessage: result.error.message };
    };
  }
};

export class McpHttpClient implements McpClient {
  async listTools(endpoint: McpEndpoint): Promise<McpTool[]> {
    return this.withClient(endpoint, (client) => this.discover(client));
  }

  async callTool(
    endpoint: McpEndpoint,
    name: string,
    input: Record<string, unknown>
  ): Promise<McpResult> {
    return this.withClient(endpoint, async (client) => {
      const tool = (await this.discover(client)).find((entry) => entry.name === name);
      if (!tool) throw new Error('The MCP server no longer offers this tool.');
      // Validate without applying defaults or stripping arguments from the approved request.
      z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]).parse(input);
      const result = await client.callTool({ name, arguments: input }, { timeout: TIMEOUT_MS });
      if ('resultType' in result && result.resultType !== 'complete') {
        throw new Error('This MCP tool requires an unsupported interactive or deferred result.');
      }
      const body = JSON.stringify(result);
      return {
        body: body.slice(0, MAX_RESULT_CHARS),
        truncated: body.length > MAX_RESULT_CHARS,
        isError: result.isError === true
      };
    });
  }

  private async discover(client: Client): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const result = await client.listTools(cursor ? { cursor } : {}, { timeout: TIMEOUT_MS });
      for (const tool of result.tools) {
        if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name) || seen.has(tool.name)) {
          throw new Error('The MCP server returned invalid or duplicate tool names.');
        }
        seen.add(tool.name);
        // Unsupported schemas fail discovery instead of silently weakening validation.
        z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
        tools.push({
          name: tool.name,
          description: tool.description ?? tool.name,
          inputSchema: tool.inputSchema
        });
        if (tools.length > 1000) throw new Error('The MCP server returned too many tools.');
      }
      cursor = result.nextCursor;
      if (!cursor) return tools;
    }
    throw new Error('The MCP tool listing exceeded the page limit.');
  }

  private async withClient<T>(
    endpoint: McpEndpoint,
    run: (client: Client) => Promise<T>
  ): Promise<T> {
    const client = new Client(
      { name: 'endeavor', version: '0.1.0' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'auto' },
        jsonSchemaValidator: validator,
        listMaxPages: 20
      }
    );
    const deadline = AbortSignal.timeout(TIMEOUT_MS);
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: endpoint.headers, redirect: 'error' },
      fetch: async (url, init) => {
        const response = await fetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])])
        });
        if (!response.body) return response;
        let size = 0;
        const body = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              size += chunk.byteLength;
              if (size > MAX_RESPONSE_BYTES) throw new Error('The MCP response exceeded 2 MB.');
              controller.enqueue(chunk);
            }
          })
        );
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    });
    try {
      await client.connect(transport, { timeout: TIMEOUT_MS });
      return await run(client);
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
