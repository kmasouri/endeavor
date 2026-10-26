-- The example feature that docs/adding-a-feature.md copies.
CREATE TABLE endeavor.items (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_items_name_unique ON endeavor.items (lower(name));
