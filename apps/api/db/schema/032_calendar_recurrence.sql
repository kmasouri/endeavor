-- Existing interval schedules keep all their slots, run keys, and catch-up questions.
ALTER TABLE bold_cedar_007.responsibilities
  ALTER COLUMN interval_minutes DROP NOT NULL,
  ADD COLUMN recurrence jsonb,
  ADD CONSTRAINT responsibilities_schedule_kind CHECK (
    (recurrence IS NULL AND interval_minutes IS NOT NULL)
    OR (recurrence IS NOT NULL AND interval_minutes IS NULL AND jsonb_typeof(recurrence) = 'object')
  );

-- Protect starts from different slots or manual requests racing each other.
-- Existing duplicate open runs must be resolved before this migration; no task is deleted.
CREATE UNIQUE INDEX idx_tasks_one_open_responsibility
  ON bold_cedar_007.tasks (responsibility_id)
  WHERE responsibility_id IS NOT NULL AND state IN ('working', 'waiting', 'blocked');
