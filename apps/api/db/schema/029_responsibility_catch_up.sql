-- 'ask' (the new default): one missed run still runs when the service is back. When several
-- were missed, or the next run is close, a person is asked whether to run now or wait.
ALTER TABLE bold_cedar_007.responsibilities
  DROP CONSTRAINT IF EXISTS responsibilities_missed_run_policy_check;
ALTER TABLE bold_cedar_007.responsibilities
  ADD CONSTRAINT responsibilities_missed_run_policy_check
  CHECK (missed_run_policy IN ('ask', 'run_once', 'skip'));
ALTER TABLE bold_cedar_007.responsibilities
  ALTER COLUMN missed_run_policy SET DEFAULT 'ask';

-- The open "run now or wait?" question, if any: the missed slot and how many runs were missed.
-- Cleared when a person answers or when the next run comes due.
ALTER TABLE bold_cedar_007.responsibilities
  ADD COLUMN IF NOT EXISTS catch_up_slot timestamptz,
  ADD COLUMN IF NOT EXISTS catch_up_missed integer;
