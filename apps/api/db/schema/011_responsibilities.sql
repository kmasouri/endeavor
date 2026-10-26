-- A recurring piece of work for one agent. Each run is an ordinary task with this
-- responsibility_id. The responsibility's own status (enabled, paused, cancelled) is separate
-- from any run's state: finishing or cancelling a run never touches the schedule, and
-- cancelling the schedule never stops an active run.
CREATE TABLE endeavor.responsibilities (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES endeavor.agents (id),
  conversation_id uuid REFERENCES endeavor.conversations (id),
  title text NOT NULL,
  brief text NOT NULL,
  completion_criteria text NOT NULL,
  -- The schedule is either a fixed interval or a calendar rule, never both.
  interval_minutes integer CHECK (interval_minutes >= 5),
  recurrence jsonb,
  -- What to do about runs missed while the computer or service was off. 'ask': one missed run
  -- still runs when the service is back; when several were missed, or the next run is close,
  -- a person is asked whether to run now or wait. 'run_once': start one run. 'skip': start
  -- none, and record the skipped runs.
  missed_run_policy text NOT NULL CHECK (missed_run_policy IN ('ask', 'run_once', 'skip'))
    DEFAULT 'ask',
  status text NOT NULL CHECK (status IN ('enabled', 'paused', 'cancelled')) DEFAULT 'enabled',
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  -- The open "run now or wait?" question, if any: the missed slot and how many runs were
  -- missed. Cleared when a person answers or when the next run comes due.
  catch_up_slot timestamptz,
  catch_up_missed integer,
  created_by_human_id uuid NOT NULL REFERENCES endeavor.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT responsibilities_schedule_kind CHECK (
    (recurrence IS NULL AND interval_minutes IS NOT NULL)
    OR (recurrence IS NOT NULL AND interval_minutes IS NULL AND jsonb_typeof(recurrence) = 'object')
  )
);

CREATE INDEX idx_responsibilities_due ON endeavor.responsibilities (next_run_at)
  WHERE status = 'enabled';

CREATE TRIGGER guard_deleted_agent_schedules BEFORE INSERT OR UPDATE ON endeavor.responsibilities
  FOR EACH ROW EXECUTE FUNCTION endeavor.guard_deleted_agent_work();

-- Runs must point at a real responsibility.
ALTER TABLE endeavor.tasks
  ADD CONSTRAINT fk_tasks_responsibility
  FOREIGN KEY (responsibility_id) REFERENCES endeavor.responsibilities (id);

CREATE INDEX idx_tasks_responsibility ON endeavor.tasks (responsibility_id, created_at)
  WHERE responsibility_id IS NOT NULL;

-- At most one open run per responsibility, so starts from different slots or manual requests
-- can't race each other.
CREATE UNIQUE INDEX idx_tasks_one_open_responsibility ON endeavor.tasks (responsibility_id)
  WHERE responsibility_id IS NOT NULL AND state IN ('working', 'waiting', 'blocked');
