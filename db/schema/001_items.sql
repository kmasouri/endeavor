CREATE TABLE IF NOT EXISTS bold_cedar_007.items (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_unique
  ON bold_cedar_007.items (lower(name));
