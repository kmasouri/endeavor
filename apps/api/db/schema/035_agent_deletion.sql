-- Deleted identities remain only to keep shared history and foreign keys intact.
ALTER TABLE endeavor.agents ADD COLUMN deleted_at timestamptz;
DROP INDEX endeavor.idx_agents_name_unique;
CREATE UNIQUE INDEX idx_agents_name_unique ON endeavor.agents (lower(name))
  WHERE deleted_at IS NULL;

-- Lock the identity while creating or changing work. Deletion locks it before cancelling
-- work, so a concurrent insert cannot slip past the cancellation transaction.
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
CREATE TRIGGER guard_deleted_agent_tasks BEFORE INSERT OR UPDATE ON endeavor.tasks
  FOR EACH ROW EXECUTE FUNCTION endeavor.guard_deleted_agent_work();
CREATE TRIGGER guard_deleted_agent_schedules BEFORE INSERT OR UPDATE ON endeavor.responsibilities
  FOR EACH ROW EXECUTE FUNCTION endeavor.guard_deleted_agent_work();
