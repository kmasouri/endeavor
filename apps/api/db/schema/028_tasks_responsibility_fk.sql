-- Runs must point at a real responsibility. Added after the responsibilities table exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_responsibility'
  ) THEN
    ALTER TABLE bold_cedar_007.tasks
      ADD CONSTRAINT fk_tasks_responsibility
      FOREIGN KEY (responsibility_id) REFERENCES bold_cedar_007.responsibilities (id);
  END IF;
END $$;
