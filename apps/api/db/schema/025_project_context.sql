-- Project background has its own object so more context fields can be added later.
ALTER TABLE endeavor.projects
  ADD COLUMN context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT projects_context_object CHECK (jsonb_typeof(context) = 'object'),
  ADD CONSTRAINT projects_context_about CHECK (
    NOT (context ? 'about') OR (
      jsonb_typeof(context -> 'about') = 'string'
      AND char_length(context ->> 'about') BETWEEN 1 AND 5000
    )
  );
