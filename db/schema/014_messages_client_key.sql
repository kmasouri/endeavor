-- A key the sender chooses, so sending the same message twice saves it once. The runner uses
-- the tool call ID, so a tool call that runs again after a crash doesn't post twice.
ALTER TABLE bold_cedar_007.messages ADD COLUMN IF NOT EXISTS client_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_key
  ON bold_cedar_007.messages (client_key)
  WHERE client_key IS NOT NULL;
