-- Keep authentication requirements separate from enabled/disabled state.
ALTER TABLE endeavor.connections ADD COLUMN auth_method text NOT NULL DEFAULT 'none'
  CHECK (auth_method IN ('none', 'header', 'oauth'));
UPDATE endeavor.connections c SET auth_method = CASE
  WHEN EXISTS (SELECT 1 FROM endeavor.connection_oauth o WHERE o.connection_id = c.id) THEN 'oauth'
  WHEN c.credential_ciphertext IS NOT NULL THEN 'header'
  ELSE 'none'
END;
ALTER TABLE endeavor.connections ADD CONSTRAINT connections_oauth_mcp_only
  CHECK (auth_method <> 'oauth' OR kind = 'mcp');
