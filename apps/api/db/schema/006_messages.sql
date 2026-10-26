-- One post in a conversation. mentions is a list of {type, id} participants it addresses.
-- task_id is set when an agent posted it while working on a task.
CREATE TABLE endeavor.messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES endeavor.conversations (id),
  author_type text NOT NULL CHECK (author_type IN ('human', 'agent', 'system')),
  author_id uuid,
  body text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  in_reply_to_message_id uuid REFERENCES endeavor.messages (id),
  task_id uuid,
  -- A key the sender chooses, so sending the same message twice saves it once. The runner
  -- uses the tool call ID, so a tool call that runs again after a crash doesn't post twice.
  client_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON endeavor.messages (conversation_id, created_at);

CREATE UNIQUE INDEX idx_messages_client_key ON endeavor.messages (client_key)
  WHERE client_key IS NOT NULL;
