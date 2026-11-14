-- Preserve existing visibility. The old default and an explicit hide both stored false.
ALTER TABLE endeavor.skills ALTER COLUMN discoverable SET DEFAULT true;
ALTER TABLE endeavor.connections ALTER COLUMN discoverable SET DEFAULT true;
