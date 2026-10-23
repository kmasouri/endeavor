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
