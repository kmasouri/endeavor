-- Agents can find catalog entries a person marked discoverable and ask for access to them.
-- Discovery shows names, descriptions, and scope only. It never grants anything.
ALTER TABLE endeavor.skills ADD COLUMN discoverable boolean NOT NULL DEFAULT false;
ALTER TABLE endeavor.connections ADD COLUMN discoverable boolean NOT NULL DEFAULT false;

-- An access request is an approval of its own kind. The person chooses how long access lasts:
-- for the requesting task only, or ongoing for the agent.
ALTER TABLE endeavor.approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE endeavor.approvals
  ADD CONSTRAINT approvals_kind_check CHECK (kind IN ('connection_call', 'capability_access'));
ALTER TABLE endeavor.approvals
  ADD COLUMN duration text CHECK (duration IN ('task', 'ongoing'));

CREATE INDEX idx_approvals_task ON endeavor.approvals (task_id, created_at);

-- A skill or connection a person added to one task after an access request, without changing
-- the task's pinned configuration version. skill_version_id pins the exact approved skill
-- version. scope records the approved connection scope; calls use the overlap of this scope
-- and the connection's current scope, so a later catalog edit never widens it. Access ends
-- when the task finishes, or earlier when revoked_at is set. An ongoing row also needs the
-- agent's live grant, so revoking the agent's access applies to this task too.
CREATE TABLE endeavor.task_capabilities (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES endeavor.tasks (id),
  approval_id uuid NOT NULL UNIQUE REFERENCES endeavor.approvals (id),
  target_type text NOT NULL CHECK (target_type IN ('skill', 'connection')),
  target_id uuid NOT NULL,
  skill_version_id uuid REFERENCES endeavor.skill_versions (id),
  scope jsonb,
  duration text NOT NULL CHECK (duration IN ('task', 'ongoing')),
  granted_by_human_id uuid NOT NULL REFERENCES endeavor.humans (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_human_id uuid REFERENCES endeavor.humans (id),
  revoked_at timestamptz,
  CHECK ((target_type = 'skill') = (skill_version_id IS NOT NULL))
);

CREATE INDEX idx_task_capabilities_task ON endeavor.task_capabilities (task_id);
