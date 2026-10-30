-- Cursor windows must order tied timestamps without scanning and sorting whole conversations.
CREATE INDEX idx_messages_conversation_cursor ON endeavor.messages (conversation_id, created_at, id);
