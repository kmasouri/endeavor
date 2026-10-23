-- Results and evidence: text, links, files, data, or logs.
CREATE TABLE IF NOT EXISTS bold_cedar_007.task_outputs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES bold_cedar_007.tasks (id),
  kind text NOT NULL CHECK (kind IN ('text', 'link', 'file', 'data', 'log')),
  title text NOT NULL,
  content text,
  uri text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_outputs_task ON bold_cedar_007.task_outputs (task_id);
