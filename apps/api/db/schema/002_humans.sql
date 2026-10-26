-- People. The role decides what they may do (admin or member).
CREATE TABLE endeavor.humans (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  -- True only for the first person, who becomes admin without an acting person. The unique
  -- index below means two first-time setups at once can't both succeed.
  is_first boolean NOT NULL DEFAULT false,
  -- Personal display preferences. They never change stored timestamps or schedule rules.
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'dark', 'light')),
  time_format text NOT NULL DEFAULT '12h' CHECK (time_format IN ('12h', '24h')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_humans_first ON endeavor.humans (is_first) WHERE is_first;
