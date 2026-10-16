ALTER TABLE referral_program ADD COLUMN policy_json TEXT;
ALTER TABLE referral_rewards ADD COLUMN policy_snapshot_json TEXT;
CREATE TABLE referral_reward_items(
  id TEXT PRIMARY KEY,
  reward_id TEXT NOT NULL REFERENCES referral_rewards(id),
  role TEXT NOT NULL CHECK(role IN ('referrer','invitee')),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  credits INTEGER NOT NULL CHECK(credits>=0),
  credit_lot_id TEXT REFERENCES credit_lots(id),
  expires_at TEXT NOT NULL,
  reversed_credits INTEGER NOT NULL DEFAULT 0 CHECK(reversed_credits>=0),
  debt_credits INTEGER NOT NULL DEFAULT 0 CHECK(debt_credits>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(reward_id,role)
);
CREATE TABLE referral_qualification_checks(
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  attribution_id TEXT NOT NULL REFERENCES referral_attributions(id),
  status TEXT NOT NULL CHECK(status IN ('blocked','ineligible','qualified')),
  reason TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
CREATE INDEX referral_reward_items_user ON referral_reward_items(user_id,created_at);
