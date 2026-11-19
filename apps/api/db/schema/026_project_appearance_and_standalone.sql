ALTER TABLE endeavor.projects
  ADD COLUMN icon text CHECK (icon IN ('folder', 'language', 'science', 'code', 'description', 'work_outline', 'build', 'lightbulb')),
  ADD COLUMN color text CHECK (color IN ('slate', 'sand', 'coral', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'));

ALTER TABLE endeavor.conversations ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE endeavor.project_documents
  ALTER COLUMN project_id DROP NOT NULL,
  ADD CONSTRAINT project_documents_owner CHECK (project_id IS NOT NULL OR conversation_id IS NOT NULL);
