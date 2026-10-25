-- Existing connections remain HTTP. MCP permissions name tools, not HTTP methods.
ALTER TABLE endeavor.connections
  ADD COLUMN kind text NOT NULL DEFAULT 'http' CHECK (kind IN ('http', 'mcp')),
  ADD COLUMN allowed_tools text[] NOT NULL DEFAULT '{}',
  ADD COLUMN approval_tools text[] NOT NULL DEFAULT '{}';
