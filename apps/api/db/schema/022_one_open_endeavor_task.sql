-- Do not discard or merge existing work. If older data has competing open tasks, the
-- index fails and rolls back; a person must finish or cancel the extra runs first.
CREATE UNIQUE INDEX idx_tasks_one_open_endeavor_agent
  ON endeavor.tasks (conversation_id, owner_agent_id)
  WHERE conversation_id IS NOT NULL AND state IN ('working', 'waiting', 'blocked');
