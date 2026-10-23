-- Documents people attach to a conversation: knowledge sources agents in it can read. They
-- are not saved notes, and agents can't change them.
CREATE TABLE IF NOT EXISTS bold_cedar_007.conversation_documents (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES bold_cedar_007.conversations (id),
  title text NOT NULL,
  content text NOT NULL,
  added_by_human_id uuid NOT NULL REFERENCES bold_cedar_007.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_conversation_documents_conversation
  ON bold_cedar_007.conversation_documents (conversation_id)
  WHERE deleted_at IS NULL;
