-- Saved notes (agent memory). Kept apart from instructions and messages, with where each came
-- from. deleted_at hides a note without losing who deleted it.
CREATE TABLE endeavor.agent_notes (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES endeavor.agents (id),
  body text NOT NULL,
  -- Where the note shows up. 'conversation': only in tasks in source_conversation_id, so a
  -- note never carries one conversation's details into another. 'agent': in all the agent's
  -- tasks; only admins widen a note to this.
  scope text NOT NULL DEFAULT 'conversation' CHECK (scope IN ('conversation', 'agent')),
  source_task_id uuid REFERENCES endeavor.tasks (id),
  source_conversation_id uuid REFERENCES endeavor.conversations (id),
  created_by_type text NOT NULL CHECK (created_by_type IN ('human', 'agent')),
  created_by_id uuid,
  -- The tool call that saved the note. Saving again with the same key (a replay after a
  -- crash) returns the first note instead of a copy.
  client_key text,
  updated_by_human_id uuid REFERENCES endeavor.humans (id),
  deleted_by_human_id uuid REFERENCES endeavor.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_agent_notes_agent ON endeavor.agent_notes (agent_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_agent_notes_client_key ON endeavor.agent_notes (client_key)
  WHERE client_key IS NOT NULL;
