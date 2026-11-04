-- Public handoff descriptions are unversioned, like name and purpose.
ALTER TABLE endeavor.agents
  ADD COLUMN produces text,
  ADD COLUMN needs text,
  ADD CONSTRAINT agents_produces_length CHECK (char_length(produces) <= 500),
  ADD CONSTRAINT agents_needs_length CHECK (char_length(needs) <= 500),
  ADD CONSTRAINT agents_produces_trimmed CHECK (produces IS NULL OR (produces = btrim(produces) AND produces <> '')),
  ADD CONSTRAINT agents_needs_trimmed CHECK (needs IS NULL OR (needs = btrim(needs) AND needs <> ''));
