-- Only newly verified provider facts are recorded. Historical mutable subscriptions
-- cannot establish the period or status that applied to an earlier payment.
CREATE TABLE billing_periods(
 provider_id TEXT NOT NULL,
 invoice_id TEXT NOT NULL,
 subscription_id TEXT NOT NULL,
 order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 period_start TEXT NOT NULL,
 period_end TEXT NOT NULL CHECK(period_end>period_start),
 paid_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(provider_id,invoice_id)
);
CREATE INDEX billing_periods_user_time ON billing_periods(user_id,period_start,period_end);
CREATE TABLE billing_subscription_endings(
 provider_id TEXT NOT NULL,
 subscription_id TEXT NOT NULL,
 ended_at TEXT,
 observed_at TEXT NOT NULL,
 PRIMARY KEY(provider_id,subscription_id)
);
