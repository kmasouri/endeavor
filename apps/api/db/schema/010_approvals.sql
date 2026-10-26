-- An action an agent asked to take that needs a person's approval first. The task waits on it.
-- The runner carries out an approved action and records the result. client_key keeps a tool
-- call that runs again after a crash from asking twice.
CREATE TABLE endeavor.approvals (
  id uuid PRIMARY KEY,
  client_key text NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES endeavor.tasks (id),
  agent_id uuid NOT NULL REFERENCES endeavor.agents (id),
  kind text NOT NULL CHECK (kind IN ('connection_call')),
  request jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  decided_by_human_id uuid REFERENCES endeavor.humans (id),
  decided_at timestamptz,
  reason text,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approvals_status ON endeavor.approvals (status, created_at);

CREATE INDEX idx_approvals_to_execute ON endeavor.approvals (decided_at)
  WHERE status = 'approved' AND executed_at IS NULL;
