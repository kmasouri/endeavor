-- One run of work by one agent. The state values and their transitions are in
-- src/services/tasks/task-state.ts. paused_at is a flag on top of the state, not a state.
-- run_key is unique, so asking twice for the same work finds the existing task.
-- responsibility_id points at the schedule that started it; its foreign key and indexes are
-- in 011_responsibilities.sql.
CREATE TABLE endeavor.tasks (
  id uuid PRIMARY KEY,
  run_key text NOT NULL UNIQUE,
  conversation_id uuid REFERENCES endeavor.conversations (id),
  owner_agent_id uuid NOT NULL REFERENCES endeavor.agents (id),
  agent_version_id uuid NOT NULL REFERENCES endeavor.agent_versions (id),
  title text NOT NULL,
  brief text NOT NULL,
  completion_criteria text NOT NULL,
  review_required boolean NOT NULL DEFAULT false,
  state text NOT NULL CHECK (state IN ('working', 'waiting', 'completed', 'blocked', 'cancelled')),
  state_reason text,
  paused_at timestamptz,
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('human', 'agent', 'schedule')),
  requested_by_id uuid,
  request_message_id uuid REFERENCES endeavor.messages (id),
  parent_task_id uuid REFERENCES endeavor.tasks (id),
  restarted_from_task_id uuid REFERENCES endeavor.tasks (id),
  responsibility_id uuid,
  criteria_check jsonb,
  review jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX idx_tasks_runnable ON endeavor.tasks (state, lease_expires_at)
  WHERE state = 'working' AND paused_at IS NULL;

CREATE INDEX idx_tasks_owner ON endeavor.tasks (owner_agent_id, state);

CREATE INDEX idx_tasks_conversation ON endeavor.tasks (conversation_id);

CREATE TRIGGER guard_deleted_agent_tasks BEFORE INSERT OR UPDATE ON endeavor.tasks
  FOR EACH ROW EXECUTE FUNCTION endeavor.guard_deleted_agent_work();

-- What a waiting task is waiting for. kind is reply, approval, external, or task; target_id is
-- the message, approval, or task it waits on.
CREATE TABLE endeavor.task_waits (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES endeavor.tasks (id),
  kind text NOT NULL CHECK (kind IN ('reply', 'approval', 'external', 'task')),
  target_id uuid,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution jsonb
);

CREATE INDEX idx_task_waits_open ON endeavor.task_waits (kind, target_id)
  WHERE resolved_at IS NULL;

-- Execution history. Never updated or deleted. The runner also rebuilds a task's model
-- transcript from these, so finished tool calls are not run again after a restart.
CREATE TABLE endeavor.task_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES endeavor.tasks (id),
  type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_events_task ON endeavor.task_events (task_id, id);

-- Spending is summed from these events, by agent or by conversation.
CREATE INDEX idx_task_events_cost ON endeavor.task_events (task_id)
  WHERE type IN ('model.turn', 'completion.checked');

-- Results and evidence: text, links, files, data, or logs.
CREATE TABLE endeavor.task_outputs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES endeavor.tasks (id),
  kind text NOT NULL CHECK (kind IN ('text', 'link', 'file', 'data', 'log')),
  title text NOT NULL,
  content text,
  uri text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_outputs_task ON endeavor.task_outputs (task_id);
