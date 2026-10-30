-- Appearance belongs to the profile, not to model configuration versions.
ALTER TABLE endeavor.agents
  ADD COLUMN avatar_color text CHECK (avatar_color IN ('lime', 'sky', 'teal')),
  ADD COLUMN avatar_icon text CHECK (avatar_icon IN (
    'agents', 'search', 'check', 'file', 'work', 'connections',
    'approvals', 'catalogs', 'setup', 'schedules'
  ));
