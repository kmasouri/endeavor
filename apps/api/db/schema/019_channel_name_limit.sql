-- Keep existing names intact. New names and renames are limited to 64 characters.
-- A trigger lets unrelated edits (such as budgets) preserve older, longer names.
CREATE FUNCTION endeavor.check_channel_name_length() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.title IS NOT DISTINCT FROM OLD.title THEN
      RETURN NEW;
    END IF;
  END IF;
  IF char_length(NEW.title) > 64 THEN
    RAISE EXCEPTION 'Channel names must be no more than 64 characters'
      USING ERRCODE = '23514', CONSTRAINT = 'conversations_channel_name_length';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversations_channel_name_length
BEFORE INSERT OR UPDATE OF title ON endeavor.conversations
FOR EACH ROW EXECUTE FUNCTION endeavor.check_channel_name_length();
