import { createServer, type Server } from 'node:http';
import { McpHttpClient } from './mcp-http.client';

// A real local HTTP server exercises MCP handshake, discovery, and execution without a model
// provider, external account, or database. It speaks the compatible 2025 MCP protocol.
describe('McpHttpClient', () => {
  let server: Server;
  let url: string;
  let requests: { method: string; params?: Record<string, unknown> }[];
  let failTool: boolean;
  let sse: boolean;
  let redirect: boolean;
  let vendorOutput: boolean;
  const tools = [
    {
      name: 'lookup',
      description: 'Look up a record',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'create',
      description: 'Create a record',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false
      }
    }
  ];

  beforeEach(async () => {
    requests = [];
    failTool = false;
    sse = false;
    redirect = false;
    vendorOutput = false;
    server = createServer(async (req, res) => {
      if (redirect) {
        res.writeHead(307, { location: `${url}/other` });
        res.end();
        return;
      }
      if (req.headers.authorization !== 'Bearer test-secret') {
        res.writeHead(401);
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      requests.push(message);
      if (message.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      let result;
      if (message.method === 'initialize')
        result = {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'local-test', version: '1' }
        };
      if (message.method === 'tools/list')
        result = {
          tools: (message.params?.cursor ? [tools[1]] : [tools[0]]).map((tool) =>
            vendorOutput
              ? { ...tool, outputSchema: { type: 'object', not: { required: ['forbidden'] } } }
              : tool
          ),
          ...(!message.params?.cursor && { nextCursor: 'page2' })
        };
      if (message.method === 'tools/call')
        result = {
          content: [{ type: 'text', text: JSON.stringify(message.params) }],
          isError: failTool,
          ...(vendorOutput && {
            _meta: { serverInfo: { icons: ['x'.repeat(25_000)] } },
            structuredContent: { content: [{ type: 'text', text: JSON.stringify(message.params) }] }
          })
        };
      const response = {
        jsonrpc: '2.0',
        id: message.id,
        ...(result ? { result } : { error: { code: -32601, message: 'Method not found' } })
      };
      if (sse && message.method === 'tools/call') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    url = `http://127.0.0.1:${address.port}/mcp`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });
  const endpoint = () => ({ url, headers: { Authorization: 'Bearer test-secret' } });

  it('discovers paginated named tools and calls a tool with exact arguments', async () => {
    const client = new McpHttpClient();
    expect(await client.listTools(endpoint())).toEqual(tools);
    const result = await client.callTool(endpoint(), 'create', { title: 'A record' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.body).content[0].text).toContain('A record');
    expect(requests.filter((r) => r.method === 'tools/call')).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ name: 'create', arguments: { title: 'A record' } })
      })
    ]);
  });

  it('validates arguments and refuses unavailable tools before invoking them', async () => {
    const client = new McpHttpClient();
    await expect(client.callTool(endpoint(), 'lookup', { id: 1 })).rejects.toThrow();
    await expect(client.callTool(endpoint(), 'removed', {})).rejects.toThrow('no longer offers');
    expect(requests.some((r) => r.method === 'tools/call')).toBe(false);
  });

  it('accepts SSE responses and preserves tool errors', async () => {
    sse = true;
    failTool = true;
    const result = await new McpHttpClient().callTool(endpoint(), 'lookup', { id: '42' });
    expect(result.isError).toBe(true);
  });

  it('keeps vendor output opaque without weakening input checks or filling results with metadata', async () => {
    vendorOutput = true;
    const client = new McpHttpClient();
    const result = await client.callTool(endpoint(), 'lookup', { id: '42' });
    expect(result.isError).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.body).not.toContain('icons');
    expect(JSON.parse(result.body)).toEqual({
      content: [
        { type: 'text', text: JSON.stringify({ name: 'lookup', arguments: { id: '42' } }) }
      ],
      isError: false
    });
    await expect(client.callTool(endpoint(), 'lookup', { id: 1 })).rejects.toThrow();
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(1);
  });

  it('does not follow redirects or invoke a tool with invalid credentials', async () => {
    redirect = true;
    await expect(new McpHttpClient().listTools(endpoint())).rejects.toThrow();
    redirect = false;
    await expect(new McpHttpClient().listTools({ url, headers: {} })).rejects.toThrow();
    expect(requests.some((r) => r.method === 'tools/call')).toBe(false);
  });
});
