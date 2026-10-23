-- What a waiting task is waiting for. kind is reply, approval, external, or task; target_id is
-- the message, approval, or task it waits on.
CREATE TABLE IF NOT EXISTS bold_cedar_007.task_waits (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES bold_cedar_007.tasks (id),
  kind text NOT NULL CHECK (kind IN ('reply', 'approval', 'external', 'task')),
  target_id uuid,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution jsonb
);

CREATE INDEX IF NOT EXISTS idx_task_waits_open
  ON bold_cedar_007.task_waits (kind, target_id)
  WHERE resolved_at IS NULL;
