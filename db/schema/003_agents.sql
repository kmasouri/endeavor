-- A configured agent. Its settings live in agent_versions; current_version_id is what new
-- tasks use.
CREATE TABLE IF NOT EXISTS bold_cedar_007.agents (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  purpose text NOT NULL,
  current_version_id uuid,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name_unique
  ON bold_cedar_007.agents (lower(name));
