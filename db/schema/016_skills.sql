-- A reusable skill in the shared catalog. Its content is in skill_versions; current_version_id
-- is what new agent configurations pick up. Being in the catalog grants no agent anything.
CREATE TABLE IF NOT EXISTS bold_cedar_007.skills (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  current_version_id uuid,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_name_unique ON bold_cedar_007.skills (lower(name));
