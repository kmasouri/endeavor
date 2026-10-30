-- The answer and its task are committed together. Failed starts leave the question pending.
CREATE TABLE endeavor.catch_up_decisions (
  responsibility_id uuid NOT NULL REFERENCES endeavor.responsibilities(id),
  slot timestamptz NOT NULL,
  next_run_at timestamptz NOT NULL,
  decision text NOT NULL CHECK (decision IN ('run', 'wait')),
  task_id uuid REFERENCES endeavor.tasks(id),
  resolved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (responsibility_id, slot, next_run_at),
  CHECK ((decision = 'run' AND task_id IS NOT NULL) OR (decision = 'wait' AND task_id IS NULL))
);
