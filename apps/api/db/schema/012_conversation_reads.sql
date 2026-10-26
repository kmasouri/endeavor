-- The last message each person has seen in a conversation. Messages after it, written by
-- someone else, are unread. It only moves forward, in the same order as the message list
-- (created_at, then id).
CREATE TABLE endeavor.conversation_reads (
  conversation_id uuid NOT NULL REFERENCES endeavor.conversations (id),
  human_id uuid NOT NULL REFERENCES endeavor.humans (id),
  last_read_message_id uuid NOT NULL REFERENCES endeavor.messages (id),
  last_read_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, human_id)
);

-- Start current members at the newest message, so existing conversations don't all show as
-- unread the first time the counts appear.
INSERT INTO endeavor.conversation_reads (
  conversation_id, human_id, last_read_message_id, last_read_at
)
SELECT DISTINCT ON (cm.conversation_id, cm.participant_id)
  cm.conversation_id, cm.participant_id, m.id, m.created_at
FROM endeavor.conversation_members cm
JOIN endeavor.messages m ON m.conversation_id = cm.conversation_id
WHERE cm.participant_type = 'human'
  AND cm.removed_at IS NULL
ORDER BY cm.conversation_id, cm.participant_id, m.created_at DESC, m.id DESC;
