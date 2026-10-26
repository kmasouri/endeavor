import { createHash } from 'node:crypto';

// MCP tools are offered to the model under stable names: the connection ID without dashes,
// and a short hash of the server's tool name. Hashing keeps the name short and safe for every
// provider, whatever the server calls its tools.

const MCP_TOOL_NAME_PATTERN = /^mcp_([a-f0-9]{32})_(.+)$/;

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp_');
}

export function buildMcpToolName(connectionId: string, tool: string): string {
  const toolHash = createHash('sha256').update(tool).digest('hex').slice(0, 20);
  return `mcp_${connectionId.replaceAll('-', '')}_${toolHash}`;
}

// Returns the connection ID a tool name points at, or null when it isn't an MCP tool name.
export function parseMcpConnectionId(name: string): string | null {
  const match = MCP_TOOL_NAME_PATTERN.exec(name);
  if (!match) {
    return null;
  }
  const hex = match[1];
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}
