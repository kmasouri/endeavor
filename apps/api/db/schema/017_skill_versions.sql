-- One saved version of a skill: instructions for the model, and the connections the skill
-- uses. Never changed once saved; an edit adds a version.
CREATE TABLE IF NOT EXISTS bold_cedar_007.skill_versions (
  id uuid PRIMARY KEY,
  skill_id uuid NOT NULL REFERENCES bold_cedar_007.skills (id),
  version integer NOT NULL CHECK (version > 0),
  instructions text NOT NULL,
  connection_ids uuid[] NOT NULL DEFAULT '{}',
  created_by_human_id uuid REFERENCES bold_cedar_007.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version)
);
