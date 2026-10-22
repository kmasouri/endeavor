CREATE TABLE IF NOT EXISTS bold_cedar_007.conversations (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  created_by_human_id uuid NOT NULL REFERENCES bold_cedar_007.humans (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
