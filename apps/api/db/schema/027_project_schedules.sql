ALTER TABLE endeavor.responsibilities
  ADD COLUMN project_id uuid REFERENCES endeavor.projects (id),
  ALTER COLUMN agent_id DROP NOT NULL;

UPDATE endeavor.responsibilities r
SET project_id = COALESCE(
  (SELECT c.project_id FROM endeavor.conversations c WHERE c.id = r.conversation_id),
  (SELECT p.id FROM endeavor.projects p WHERE p.is_default)
);

ALTER TABLE endeavor.responsibilities ALTER COLUMN project_id SET NOT NULL;

-- Slot advancement and catch-up answers do not change the pin. Keep their schedule locks
-- independent of agent deletion, which locks the agent first and then cancels its schedules.
DROP TRIGGER guard_deleted_agent_schedules ON endeavor.responsibilities;
CREATE TRIGGER guard_deleted_agent_schedules
  BEFORE INSERT OR UPDATE OF agent_id, status ON endeavor.responsibilities
  FOR EACH ROW EXECUTE FUNCTION endeavor.guard_deleted_agent_work();
CREATE INDEX idx_responsibilities_project ON endeavor.responsibilities (project_id);

-- A run can exist before an agent is assigned. The starter message links routing and
-- delivery to the same run, including after a retry or a human routing choice.
CREATE TABLE endeavor.responsibility_runs (
  run_key text PRIMARY KEY,
  responsibility_id uuid NOT NULL REFERENCES endeavor.responsibilities (id),
  conversation_id uuid NOT NULL UNIQUE REFERENCES endeavor.conversations (id),
  starter_message_id uuid NOT NULL UNIQUE REFERENCES endeavor.messages (id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_responsibility_runs_history
  ON endeavor.responsibility_runs (responsibility_id, created_at DESC);

ALTER TABLE endeavor.catch_up_decisions
  ADD COLUMN run_key text REFERENCES endeavor.responsibility_runs (run_key);

-- Keep historical answers linked to the task they started.
ALTER TABLE endeavor.catch_up_decisions DROP CONSTRAINT catch_up_decisions_check;
ALTER TABLE endeavor.catch_up_decisions ADD CHECK (
  (decision = 'run' AND num_nonnulls(task_id, run_key) = 1)
  OR (decision = 'wait' AND task_id IS NULL AND run_key IS NULL)
);

CREATE VIEW endeavor.responsibility_run_history AS
SELECT r.run_key, r.responsibility_id, r.conversation_id, r.created_at, t.id AS task_id,
  CASE
    WHEN t.state IN ('working', 'waiting', 'blocked') THEN t.state
    WHEN c.closed_at IS NULL AND d.status = 'waiting' THEN 'waiting'
    WHEN c.closed_at IS NULL AND (d.status = 'pending' OR (m.delivered_at IS NULL
      AND m.failed_at IS NULL AND m.message_id IS NOT NULL)) THEN 'routing'
    ELSE COALESCE(t.state, 'skipped')
  END AS state
FROM endeavor.responsibility_runs r
JOIN endeavor.conversations c ON c.id = r.conversation_id
LEFT JOIN endeavor.routing_decisions d ON d.message_id = r.starter_message_id
LEFT JOIN endeavor.message_deliveries m
  ON m.message_id = d.delivery_message_id AND m.agent_id = d.selected_agent_id
LEFT JOIN LATERAL (
  SELECT id, state FROM endeavor.tasks
  WHERE responsibility_id = r.responsibility_id AND conversation_id = r.conversation_id
  ORDER BY (state IN ('working', 'waiting', 'blocked')) DESC, created_at DESC, id DESC LIMIT 1
) t ON true
UNION ALL
SELECT t.run_key, t.responsibility_id, t.conversation_id, t.created_at, t.id, t.state
FROM endeavor.tasks t
WHERE t.responsibility_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM endeavor.responsibility_runs r WHERE r.conversation_id = t.conversation_id);
