-- Execution history. Never updated or deleted. The runner also rebuilds a task's model
-- transcript from these, so finished tool calls are not run again after a restart.
CREATE TABLE IF NOT EXISTS bold_cedar_007.task_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES bold_cedar_007.tasks (id),
  type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_events_task ON bold_cedar_007.task_events (task_id, id);
