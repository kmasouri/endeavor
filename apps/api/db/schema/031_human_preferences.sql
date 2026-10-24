-- Personal display preferences never change stored timestamps or schedule rules.
ALTER TABLE bold_cedar_007.humans
  ADD COLUMN theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'dark', 'light')),
  ADD COLUMN time_format text NOT NULL DEFAULT '12h' CHECK (time_format IN ('12h', '24h'));
