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
