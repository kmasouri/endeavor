-- OAuth state, client secrets, PKCE verifiers, and tokens are encrypted together.
CREATE TABLE endeavor.connection_oauth (
  connection_id uuid PRIMARY KEY REFERENCES endeavor.connections(id) ON DELETE CASCADE,
  session_ciphertext text NOT NULL
);
