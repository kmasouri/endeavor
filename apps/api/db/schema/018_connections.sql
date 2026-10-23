-- A connection to an outside HTTP API in the shared catalog. allowed_methods and
-- allowed_path_prefixes limit what any agent can do through it. The credential is encrypted
-- with CREDENTIALS_KEY (AES-256-GCM) and never returned by the API.
CREATE TABLE IF NOT EXISTS bold_cedar_007.connections (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  base_url text NOT NULL,
  auth_header text NOT NULL DEFAULT 'Authorization',
  credential_ciphertext text,
  allowed_methods text[] NOT NULL DEFAULT '{GET}',
  allowed_path_prefixes text[] NOT NULL DEFAULT '{/}',
  disabled_at timestamptz,
  created_by_human_id uuid REFERENCES bold_cedar_007.humans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_name_unique
  ON bold_cedar_007.connections (lower(name));
