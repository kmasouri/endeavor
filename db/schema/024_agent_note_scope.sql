-- Where a saved note shows up. 'conversation': only in tasks in source_conversation_id, so a
-- note never carries one conversation's details into another. 'agent': in all the agent's
-- tasks; only admins widen a note to this.
ALTER TABLE bold_cedar_007.agent_notes
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'conversation'
    CHECK (scope IN ('conversation', 'agent'));
