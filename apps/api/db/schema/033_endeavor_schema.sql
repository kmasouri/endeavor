-- Rename the schema and migration ledger together; all records and permissions stay in place.
DO $$
BEGIN
  IF to_regnamespace('bold_cedar_007') IS NOT NULL THEN
    IF to_regnamespace('endeavor') IS NOT NULL THEN
      RAISE EXCEPTION 'Both endeavor and the legacy schema exist';
    END IF;
    ALTER SCHEMA bold_cedar_007 RENAME TO endeavor;
  END IF;
END $$;
