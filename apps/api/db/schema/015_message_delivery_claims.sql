-- Lets several runners share deliveries safely, and stops a delivery that keeps failing from
-- blocking newer ones. A runner claims a row until claimed_until. A row that has failed
-- 5 times gets failed_at and is skipped from then on.
ALTER TABLE bold_cedar_007.message_deliveries
  ADD COLUMN IF NOT EXISTS claimed_until timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

DROP INDEX IF EXISTS bold_cedar_007.idx_message_deliveries_pending;

CREATE INDEX IF NOT EXISTS idx_message_deliveries_pending
  ON bold_cedar_007.message_deliveries (created_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;
