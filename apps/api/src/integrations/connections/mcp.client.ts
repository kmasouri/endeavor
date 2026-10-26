export interface McpEndpoint {
  url: string;
  headers: Record<string, string>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResult {
  body: string;
  truncated: boolean;
  isError: boolean;
}

// The runner owns permissions and approvals; this client only speaks MCP.
export interface McpClient {
  listTools(endpoint: McpEndpoint): Promise<McpTool[]>;
  callTool(endpoint: McpEndpoint, name: string, input: Record<string, unknown>): Promise<McpResult>;
}

export class McpAuthenticationError extends Error {
  constructor() {
    super('The MCP server requires sign-in.');
  }
}
