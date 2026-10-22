-- Which catalog entries an agent may use, apart from its configuration versions. Revoking sets
-- revoked_at, and the runner checks this on every tool call, so a revoke applies at once, even
-- to tasks on older versions.
CREATE TABLE IF NOT EXISTS bold_cedar_007.agent_grants (
  agent_id uuid NOT NULL REFERENCES bold_cedar_007.agents (id),
  target_type text NOT NULL CHECK (target_type IN ('skill', 'connection')),
  target_id uuid NOT NULL,
  granted_by_human_id uuid REFERENCES bold_cedar_007.humans (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_human_id uuid REFERENCES bold_cedar_007.humans (id),
  revoked_at timestamptz,
  PRIMARY KEY (agent_id, target_type, target_id)
);
