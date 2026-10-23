-- One saved version of an agent's settings. Rows are never updated: an edit adds a version.
CREATE TABLE IF NOT EXISTS bold_cedar_007.agent_versions (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES bold_cedar_007.agents (id),
  version integer NOT NULL CHECK (version > 0),
  instructions text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  skill_ids uuid[] NOT NULL DEFAULT '{}',
  connection_ids uuid[] NOT NULL DEFAULT '{}',
  created_by_human_id uuid REFERENCES bold_cedar_007.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);
