-- A recurring piece of work for one agent. Each run is an ordinary task with this
-- responsibility_id. The responsibility's own status (enabled, paused, cancelled) is separate
-- from any run's state: finishing or cancelling a run never touches the schedule, and
-- cancelling the schedule never stops an active run.
CREATE TABLE IF NOT EXISTS bold_cedar_007.responsibilities (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES bold_cedar_007.agents (id),
  conversation_id uuid REFERENCES bold_cedar_007.conversations (id),
  title text NOT NULL,
  brief text NOT NULL,
  completion_criteria text NOT NULL,
  interval_minutes integer NOT NULL CHECK (interval_minutes >= 5),
  -- What to do about runs missed while the computer or service was off. 'run_once': start one
  -- run when the service comes back. 'skip': start none, and record the skipped runs.
  missed_run_policy text NOT NULL CHECK (missed_run_policy IN ('run_once', 'skip')) DEFAULT 'run_once',
  status text NOT NULL CHECK (status IN ('enabled', 'paused', 'cancelled')) DEFAULT 'enabled',
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  created_by_human_id uuid NOT NULL REFERENCES bold_cedar_007.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_responsibilities_due
  ON bold_cedar_007.responsibilities (next_run_at)
  WHERE status = 'enabled';

CREATE INDEX IF NOT EXISTS idx_tasks_responsibility
  ON bold_cedar_007.tasks (responsibility_id, created_at)
  WHERE responsibility_id IS NOT NULL;
