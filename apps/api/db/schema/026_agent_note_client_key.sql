-- The tool call that saved a note. Saving again with the same key (a replay after a crash)
-- returns the first note instead of a copy.
ALTER TABLE bold_cedar_007.agent_notes ADD COLUMN IF NOT EXISTS client_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_notes_client_key
  ON bold_cedar_007.agent_notes (client_key)
  WHERE client_key IS NOT NULL;
