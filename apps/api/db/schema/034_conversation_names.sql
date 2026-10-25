-- Channel names are real stored names, without a decorative #.
-- Keep IDs and all conversation relationships intact while upgrading old titles.
UPDATE endeavor.conversations
SET title = coalesce(
  nullif(btrim(left(regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'), 200), '-'), ''),
  'endeavor-' || id::text
);

ALTER TABLE endeavor.conversations
  ADD CONSTRAINT conversations_channel_name
  CHECK (title ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(title) <= 200);
