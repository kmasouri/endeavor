-- The durable collaboration record: people, agents, conversations, messages, tasks, and notes.
-- See the Architecture page in Notion for how these fit together.

-- People. The role decides what they may do (admin or member).
CREATE TABLE IF NOT EXISTS bold_cedar_007.humans (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS bold_cedar_007.conversations (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  created_by_human_id uuid NOT NULL REFERENCES bold_cedar_007.humans (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Who is in a conversation. history_from limits how far back an added member can read;
-- null means the whole history.
CREATE TABLE IF NOT EXISTS bold_cedar_007.conversation_members (
  conversation_id uuid NOT NULL REFERENCES bold_cedar_007.conversations (id),
  participant_type text NOT NULL CHECK (participant_type IN ('human', 'agent')),
  participant_id uuid NOT NULL,
  added_by_human_id uuid REFERENCES bold_cedar_007.humans (id),
  history_from timestamptz,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (conversation_id, participant_type, participant_id)
);

-- One post in a conversation. mentions is a list of {type, id} participants it addresses.
-- task_id is set when an agent posted it while working on a task.
CREATE TABLE IF NOT EXISTS bold_cedar_007.messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES bold_cedar_007.conversations (id),
  author_type text NOT NULL CHECK (author_type IN ('human', 'agent', 'system')),
  author_id uuid,
  body text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  in_reply_to_message_id uuid REFERENCES bold_cedar_007.messages (id),
  task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON bold_cedar_007.messages (conversation_id, created_at);

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

-- What a waiting task is waiting for. kind is reply, approval, external, or task; target_id is
-- the message, approval, or task it waits on.
CREATE TABLE IF NOT EXISTS bold_cedar_007.task_waits (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES bold_cedar_007.tasks (id),
  kind text NOT NULL CHECK (kind IN ('reply', 'approval', 'external', 'task')),
  target_id uuid,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution jsonb
);

CREATE INDEX IF NOT EXISTS idx_task_waits_open
  ON bold_cedar_007.task_waits (kind, target_id)
  WHERE resolved_at IS NULL;

-- Execution history. Never updated or deleted. The runner also rebuilds a task's model
-- transcript from these, so finished tool calls are not run again after a restart.
CREATE TABLE IF NOT EXISTS bold_cedar_007.task_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES bold_cedar_007.tasks (id),
  type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_events_task ON bold_cedar_007.task_events (task_id, id);

-- Results and evidence: text, links, files, data, or logs.
CREATE TABLE IF NOT EXISTS bold_cedar_007.task_outputs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES bold_cedar_007.tasks (id),
  kind text NOT NULL CHECK (kind IN ('text', 'link', 'file', 'data', 'log')),
  title text NOT NULL,
  content text,
  uri text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_outputs_task ON bold_cedar_007.task_outputs (task_id);

-- Saved notes (agent memory). Kept apart from instructions and messages, with where each came
-- from. deleted_at hides a note without losing who deleted it.
CREATE TABLE IF NOT EXISTS bold_cedar_007.agent_notes (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES bold_cedar_007.agents (id),
  body text NOT NULL,
  source_task_id uuid REFERENCES bold_cedar_007.tasks (id),
  source_conversation_id uuid REFERENCES bold_cedar_007.conversations (id),
  created_by_type text NOT NULL CHECK (created_by_type IN ('human', 'agent')),
  created_by_id uuid,
  updated_by_human_id uuid REFERENCES bold_cedar_007.humans (id),
  deleted_by_human_id uuid REFERENCES bold_cedar_007.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_notes_agent
  ON bold_cedar_007.agent_notes (agent_id)
  WHERE deleted_at IS NULL;
