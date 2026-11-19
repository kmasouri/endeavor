-- Projects: long-lived groups of endeavors (conversations). A project holds what outlasts one
-- goal: knowledge sources, agents' saved notes, and default people and agents. It has no chat
-- feed of its own.
CREATE TABLE endeavor.projects (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  -- The project new endeavors go into when none is named. Exactly one project has it.
  is_default boolean NOT NULL DEFAULT false,
  -- null only for the default project this file creates.
  created_by_human_id uuid REFERENCES endeavor.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE UNIQUE INDEX idx_projects_one_default ON endeavor.projects (is_default) WHERE is_default;

-- People and agents added to every new endeavor in the project.
CREATE TABLE endeavor.project_members (
  project_id uuid NOT NULL REFERENCES endeavor.projects (id),
  participant_type text NOT NULL CHECK (participant_type IN ('human', 'agent')),
  participant_id uuid NOT NULL,
  added_by_human_id uuid REFERENCES endeavor.humans (id),
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (project_id, participant_type, participant_id)
);

-- Every existing conversation moves into one "General" project (the recorded default in
-- Questions for Kayvan). IDs don't change, so this can be redone either way later.
INSERT INTO endeavor.projects (id, name, is_default)
VALUES ('00000000-0000-4000-8000-00000000d0e1', 'General', true);

-- An endeavor is one goal. The goal is the request that opened it; done_criteria say when it is
-- met, filled in from the goal and editable by people. A closed endeavor is archived; reopening
-- it clears closed_at.
ALTER TABLE endeavor.conversations
  ADD COLUMN project_id uuid REFERENCES endeavor.projects (id),
  ADD COLUMN goal text,
  ADD COLUMN goal_message_id uuid REFERENCES endeavor.messages (id),
  ADD COLUMN done_criteria text,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by_human_id uuid REFERENCES endeavor.humans (id);

UPDATE endeavor.conversations
SET project_id = '00000000-0000-4000-8000-00000000d0e1';

ALTER TABLE endeavor.conversations ALTER COLUMN project_id SET NOT NULL;

CREATE INDEX idx_conversations_project ON endeavor.conversations (project_id, created_at DESC);

-- The goal of an existing conversation is the first message a person wrote in it. The done
-- criteria match defaultDoneCriteria in services/conversations/goal.rules.ts.
UPDATE endeavor.conversations c
SET goal = first.body,
    goal_message_id = first.id,
    done_criteria = 'Done when the result meets this request and a person confirms it: '
      || left(regexp_replace(btrim(first.body), '\s+', ' ', 'g'), 300)
FROM (
  SELECT DISTINCT ON (conversation_id) conversation_id, id, body
  FROM endeavor.messages
  WHERE author_type = 'human'
  ORDER BY conversation_id, created_at, id
) first
WHERE first.conversation_id = c.id;

-- Knowledge sources belong to projects. conversation_id, when set, limits a document to that one
-- endeavor. Documents attached before projects keep it, so moving every conversation into one
-- project doesn't show one conversation's documents in another.
ALTER TABLE endeavor.conversation_documents RENAME TO project_documents;
ALTER INDEX endeavor.idx_conversation_documents_conversation
  RENAME TO idx_project_documents_conversation;
ALTER TABLE endeavor.project_documents
  ADD COLUMN project_id uuid REFERENCES endeavor.projects (id),
  ALTER COLUMN conversation_id DROP NOT NULL;

UPDATE endeavor.project_documents d
SET project_id = c.project_id
FROM endeavor.conversations c
WHERE c.id = d.conversation_id;

ALTER TABLE endeavor.project_documents ALTER COLUMN project_id SET NOT NULL;

CREATE INDEX idx_project_documents_project
  ON endeavor.project_documents (project_id)
  WHERE deleted_at IS NULL;

-- Saved notes gain a 'project' scope: shown in every endeavor of the note's project. Notes saved
-- before projects keep the 'conversation' scope (only their own endeavor) for the same reason as
-- documents.
ALTER TABLE endeavor.agent_notes
  ADD COLUMN project_id uuid REFERENCES endeavor.projects (id),
  DROP CONSTRAINT agent_notes_scope_check,
  ADD CONSTRAINT agent_notes_scope_check
    CHECK (scope IN ('conversation', 'project', 'agent'));

UPDATE endeavor.agent_notes n
SET project_id = c.project_id
FROM endeavor.conversations c
WHERE c.id = n.source_conversation_id;

ALTER TABLE endeavor.agent_notes
  ADD CONSTRAINT agent_notes_project_scope CHECK (scope <> 'project' OR project_id IS NOT NULL);

CREATE INDEX idx_agent_notes_project ON endeavor.agent_notes (project_id)
  WHERE deleted_at IS NULL;
