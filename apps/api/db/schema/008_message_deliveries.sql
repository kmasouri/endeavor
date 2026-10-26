-- One row per agent a message is addressed to. The runner turns each pending row into work:
-- an update to the agent's open task in that conversation, or a new task. Messages that
-- address no agent get no rows, so they never start any work.
--
-- Several runners can share deliveries safely: a runner claims a row until claimed_until. A
-- row that has failed 5 times gets failed_at and is skipped from then on, so it never blocks
-- newer ones.
CREATE TABLE endeavor.message_deliveries (
  message_id uuid NOT NULL REFERENCES endeavor.messages (id),
  agent_id uuid NOT NULL REFERENCES endeavor.agents (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  task_id uuid REFERENCES endeavor.tasks (id),
  claimed_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  failed_at timestamptz,
  PRIMARY KEY (message_id, agent_id)
);

CREATE INDEX idx_message_deliveries_pending ON endeavor.message_deliveries (created_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;
