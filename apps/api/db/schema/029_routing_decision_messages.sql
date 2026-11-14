-- Keep the Decision Engine prompt and its actions on one durable conversation message.
ALTER TABLE endeavor.routing_decisions
ADD COLUMN decision_message_id uuid REFERENCES endeavor.messages(id);
