-- A conversation (an endeavor in the web app). title is the channel name: lowercase words
-- joined by single dashes, without a decorative #.
CREATE TABLE endeavor.conversations (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  -- Spending cap in US dollars for all agent work in the conversation, ever. NULL means no cap.
  budget_usd numeric(12, 4) CHECK (budget_usd > 0),
  created_by_human_id uuid NOT NULL REFERENCES endeavor.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_channel_name
    CHECK (title ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(title) <= 200)
);

-- Who is in a conversation. history_from limits how far back an added member can read;
-- null means the whole history.
CREATE TABLE endeavor.conversation_members (
  conversation_id uuid NOT NULL REFERENCES endeavor.conversations (id),
  participant_type text NOT NULL CHECK (participant_type IN ('human', 'agent')),
  participant_id uuid NOT NULL,
  added_by_human_id uuid REFERENCES endeavor.humans (id),
  history_from timestamptz,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (conversation_id, participant_type, participant_id)
);

-- Documents people attach to a conversation: knowledge sources agents in it can read. They
-- are not saved notes, and agents can't change them.
CREATE TABLE endeavor.conversation_documents (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES endeavor.conversations (id),
  title text NOT NULL,
  content text NOT NULL,
  added_by_human_id uuid NOT NULL REFERENCES endeavor.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_conversation_documents_conversation
  ON endeavor.conversation_documents (conversation_id)
  WHERE deleted_at IS NULL;
