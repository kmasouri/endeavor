-- A configured agent. Its settings live in agent_versions; current_version_id is what new
-- tasks use. A deleted agent stays only to keep shared history and foreign keys intact, and
-- frees its name for a new agent.
CREATE TABLE endeavor.agents (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  purpose text NOT NULL,
  current_version_id uuid,
  -- Spending cap in US dollars for each calendar month (UTC), across all the agent's work.
  -- NULL means no cap. Not versioned: a change takes effect on the next model call.
  monthly_budget_usd numeric(12, 4) CHECK (monthly_budget_usd > 0),
  disabled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_agents_name_unique ON endeavor.agents (lower(name))
  WHERE deleted_at IS NULL;

-- One saved version of an agent's settings. Rows are never updated: an edit adds a version.
-- skill_version_ids pins exact skill versions, so a skill edit never changes running work.
CREATE TABLE endeavor.agent_versions (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES endeavor.agents (id),
  version integer NOT NULL CHECK (version > 0),
  instructions text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  skill_version_ids uuid[] NOT NULL DEFAULT '{}',
  connection_ids uuid[] NOT NULL DEFAULT '{}',
  -- Execution limits for each task: maxModelTurns, maxTokens (input plus output, a stand-in
  -- for cost), and maxWorkingMinutes (time spent working, not waiting). Empty means only the
  -- runner's own limits apply.
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_human_id uuid REFERENCES endeavor.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

-- Stops new or reopened work for a deleted agent. It locks the agent row while creating or
-- changing work. Deletion locks it before cancelling work, so a concurrent insert cannot slip
-- past the cancellation transaction. The triggers are in 007_tasks.sql and
-- 011_responsibilities.sql.
CREATE FUNCTION endeavor.guard_deleted_agent_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agent_id uuid; deleted timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    agent_id := NEW.owner_agent_id;
    IF NEW.state IN ('completed', 'cancelled') THEN RETURN NEW; END IF;
  ELSE
    agent_id := NEW.agent_id;
    IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  END IF;
  SELECT deleted_at INTO deleted FROM endeavor.agents WHERE id = agent_id FOR SHARE;
  IF deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Agent permanently deleted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
