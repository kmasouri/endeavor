-- A reusable skill in the shared catalog. Its content is in skill_versions; current_version_id
-- is what new agent configurations pick up. Being in the catalog grants no agent anything.
CREATE TABLE endeavor.skills (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  current_version_id uuid,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_skills_name_unique ON endeavor.skills (lower(name));

-- One saved version of a skill. Never changed once saved; an edit adds a version.
-- connection_ids is retired history: it never authorizes calls (see docs/catalogs.md).
CREATE TABLE endeavor.skill_versions (
  id uuid PRIMARY KEY,
  skill_id uuid NOT NULL REFERENCES endeavor.skills (id),
  version integer NOT NULL CHECK (version > 0),
  instructions text NOT NULL,
  connection_ids uuid[] NOT NULL DEFAULT '{}',
  created_by_human_id uuid REFERENCES endeavor.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version)
);

-- A connection in the shared catalog: an outside HTTP API or a remote MCP server. Its kind
-- never changes. HTTP connections limit agents by method and path; MCP connections by tool
-- name. The methods and tools in the approval_ lists need a person's approval before each
-- call. The credential is encrypted with CREDENTIALS_KEY (AES-256-GCM) and never returned by
-- the API.
CREATE TABLE endeavor.connections (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  kind text NOT NULL DEFAULT 'http' CHECK (kind IN ('http', 'mcp')),
  base_url text NOT NULL,
  auth_header text NOT NULL DEFAULT 'Authorization',
  credential_ciphertext text,
  allowed_methods text[] NOT NULL DEFAULT '{GET}',
  allowed_path_prefixes text[] NOT NULL DEFAULT '{/}',
  approval_methods text[] NOT NULL DEFAULT '{}',
  allowed_tools text[] NOT NULL DEFAULT '{}',
  approval_tools text[] NOT NULL DEFAULT '{}',
  disabled_at timestamptz,
  created_by_human_id uuid REFERENCES endeavor.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_connections_name_unique ON endeavor.connections (lower(name));

-- Which catalog entries an agent may use, apart from its configuration versions. Revoking sets
-- revoked_at, and the runner checks this on every tool call, so a revoke applies at once, even
-- to tasks on older versions.
CREATE TABLE endeavor.agent_grants (
  agent_id uuid NOT NULL REFERENCES endeavor.agents (id),
  target_type text NOT NULL CHECK (target_type IN ('skill', 'connection')),
  target_id uuid NOT NULL,
  granted_by_human_id uuid REFERENCES endeavor.humans (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_human_id uuid REFERENCES endeavor.humans (id),
  revoked_at timestamptz,
  PRIMARY KEY (agent_id, target_type, target_id)
);
