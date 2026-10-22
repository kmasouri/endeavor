-- People. The role decides what they may do (admin or member).
CREATE TABLE IF NOT EXISTS bold_cedar_007.humans (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  -- True only for the first person, who becomes admin without an acting person. The unique
  -- index below means two first-time setups at once can't both succeed.
  is_first boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_humans_first
  ON bold_cedar_007.humans (is_first)
  WHERE is_first;
