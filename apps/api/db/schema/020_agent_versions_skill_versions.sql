-- Agent versions pin exact skill versions, so a skill edit never changes running work.
ALTER TABLE bold_cedar_007.agent_versions RENAME COLUMN skill_ids TO skill_version_ids;
