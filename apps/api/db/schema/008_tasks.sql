-- One run of work by one agent. The state values and their transitions are in
-- src/services/tasks/task-state.ts. paused_at is a flag on top of the state, not a state.
-- run_key is unique, so asking twice for the same work finds the existing task.
CREATE TABLE IF NOT EXISTS bold_cedar_007.tasks (
  id uuid PRIMARY KEY,
  run_key text NOT NULL UNIQUE,
  conversation_id uuid REFERENCES bold_cedar_007.conversations (id),
  owner_agent_id uuid NOT NULL REFERENCES bold_cedar_007.agents (id),
  agent_version_id uuid NOT NULL REFERENCES bold_cedar_007.agent_versions (id),
  title text NOT NULL,
  brief text NOT NULL,
  completion_criteria text NOT NULL,
  review_required boolean NOT NULL DEFAULT false,
  state text NOT NULL CHECK (state IN ('working', 'waiting', 'completed', 'blocked', 'cancelled')),
  state_reason text,
  paused_at timestamptz,
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('human', 'agent', 'schedule')),
  requested_by_id uuid,
  request_message_id uuid REFERENCES bold_cedar_007.messages (id),
  parent_task_id uuid REFERENCES bold_cedar_007.tasks (id),
  restarted_from_task_id uuid REFERENCES bold_cedar_007.tasks (id),
  responsibility_id uuid,
  criteria_check jsonb,
  review jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tasks_runnable
  ON bold_cedar_007.tasks (state, lease_expires_at)
  WHERE state = 'working' AND paused_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_owner ON bold_cedar_007.tasks (owner_agent_id, state);

CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON bold_cedar_007.tasks (conversation_id);
