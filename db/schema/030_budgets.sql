-- Spending caps in US dollars. NULL means no cap. An agent's budget covers each calendar month
-- (UTC) across all its work; a conversation's covers all agent work in it, ever. Not versioned:
-- changing a budget takes effect on the next model call.
ALTER TABLE bold_cedar_007.agents
  ADD COLUMN IF NOT EXISTS monthly_budget_usd numeric(12, 4) CHECK (monthly_budget_usd > 0);

ALTER TABLE bold_cedar_007.conversations
  ADD COLUMN IF NOT EXISTS budget_usd numeric(12, 4) CHECK (budget_usd > 0);

-- Spending is summed from task events, by agent or by conversation.
CREATE INDEX IF NOT EXISTS idx_task_events_cost
  ON bold_cedar_007.task_events (task_id)
  WHERE type IN ('model.turn', 'completion.checked');
