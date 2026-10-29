-- Claim each HTTP action before sending it. A claim without a response is an unknown
-- outcome, never permission to send the request again. Request bodies and credentials
-- are not stored here; the hash binds the call to its original request.
CREATE TABLE endeavor.http_calls (
  task_id uuid NOT NULL REFERENCES endeavor.tasks (id),
  call_id text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (task_id, call_id),
  CHECK (length(call_id) > 0),
  CHECK (length(request_hash) = 64),
  CHECK ((response IS NULL) = (finished_at IS NULL))
);
