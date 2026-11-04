-- Durable decisions for unaddressed requests and completed tasks. Only new work is routed.
CREATE TABLE endeavor.routing_epoch (started_at timestamptz NOT NULL DEFAULT now());
INSERT INTO endeavor.routing_epoch DEFAULT VALUES;
CREATE TABLE endeavor.routing_decisions (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES endeavor.conversations(id),
  message_id uuid REFERENCES endeavor.messages(id),
  task_id uuid REFERENCES endeavor.tasks(id),
  kind text NOT NULL CHECK (kind IN ('starter', 'handoff')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'waiting', 'resolved', 'skipped')),
  selected_agent_id uuid REFERENCES endeavor.agents(id),
  outcome text,
  reason text NOT NULL DEFAULT '',
  confidence double precision NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  candidates jsonb NOT NULL DEFAULT '[]',
  model text,
  usage jsonb,
  revision integer NOT NULL DEFAULT 0,
  lease_token uuid,
  claimed_until timestamptz,
  delivery_message_id uuid REFERENCES endeavor.messages(id),
  decided_by_human_id uuid REFERENCES endeavor.humans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'starter' AND message_id IS NOT NULL AND task_id IS NULL)
      OR (kind = 'handoff' AND task_id IS NOT NULL)),
  UNIQUE (message_id, kind),
  UNIQUE (task_id, kind)
);
CREATE INDEX routing_pending ON endeavor.routing_decisions(created_at) WHERE status = 'pending';
