-- One row per agent a message is addressed to. The runner turns each pending row into work:
-- an update to the agent's open task in that conversation, or a new task. Messages that
-- address no agent get no rows, so they never start any work.
CREATE TABLE IF NOT EXISTS bold_cedar_007.message_deliveries (
  message_id uuid NOT NULL REFERENCES bold_cedar_007.messages (id),
  agent_id uuid NOT NULL REFERENCES bold_cedar_007.agents (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  task_id uuid REFERENCES bold_cedar_007.tasks (id),
  PRIMARY KEY (message_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_pending
  ON bold_cedar_007.message_deliveries (created_at)
  WHERE delivered_at IS NULL;
