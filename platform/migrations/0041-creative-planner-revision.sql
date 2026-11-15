-- Bind new planning attempts to the actual text planner without storing its credentials.
-- NULL identifies historical records whose planner connection was not recorded.
ALTER TABLE creative_briefs ADD COLUMN planner_revision TEXT;
