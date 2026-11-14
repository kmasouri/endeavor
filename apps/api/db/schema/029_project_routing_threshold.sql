ALTER TABLE endeavor.projects
  ADD COLUMN routing_confidence_threshold double precision
  CHECK (routing_confidence_threshold BETWEEN 0 AND 1);
