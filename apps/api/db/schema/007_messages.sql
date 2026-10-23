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
