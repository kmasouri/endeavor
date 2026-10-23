-- Per-version execution limits for each task: maxModelTurns, maxTokens (input plus output, a
-- stand-in for cost), and maxWorkingMinutes (time spent working, not waiting). Empty means
-- only the runner's own limits apply.
ALTER TABLE bold_cedar_007.agent_versions
  ADD COLUMN IF NOT EXISTS limits jsonb NOT NULL DEFAULT '{}'::jsonb;
