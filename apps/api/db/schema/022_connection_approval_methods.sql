-- HTTP methods on a connection that need a person's approval before each call.
ALTER TABLE bold_cedar_007.connections
  ADD COLUMN IF NOT EXISTS approval_methods text[] NOT NULL DEFAULT '{}';
