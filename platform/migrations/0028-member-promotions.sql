ALTER TABLE plans ADD COLUMN prepaid_terms_json TEXT;
ALTER TABLE plans ADD COLUMN promotion_json TEXT;
CREATE TABLE billing_environment_binding(
 id TEXT PRIMARY KEY CHECK(id='installation'),
 environment TEXT NOT NULL CHECK(environment IN('test','live')),
 created_at TEXT NOT NULL
);
CREATE TRIGGER billing_environment_no_update BEFORE UPDATE ON billing_environment_binding BEGIN
 SELECT RAISE(ABORT,'Billing environment cannot be changed in place');
END;
CREATE TRIGGER billing_environment_no_delete BEFORE DELETE ON billing_environment_binding BEGIN
 SELECT RAISE(ABORT,'Billing environment cannot be deleted in place');
END;
CREATE TABLE promotion_claims(
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 environment TEXT NOT NULL CHECK(environment IN('test','live')),
 promotion_id TEXT NOT NULL,
 promotion_version INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN('reserved','consumed','released')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX promotion_claim_one_pending ON promotion_claims(user_id,environment) WHERE status='reserved';
CREATE TABLE prepaid_membership_purchases(
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 plan_id TEXT NOT NULL REFERENCES plans(id),
 paid_at TEXT NOT NULL,
 terms_json TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_minor>=0),
 credit_lot_id TEXT REFERENCES credit_lots(id),
 reversed_credits INTEGER NOT NULL DEFAULT 0,
 debt_credits INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE INDEX prepaid_membership_space ON prepaid_membership_purchases(workspace_id,plan_id,paid_at,order_id);
CREATE TABLE prepaid_refund_reservations(
 order_id TEXT NOT NULL REFERENCES prepaid_membership_purchases(order_id),
 event_key TEXT NOT NULL,
 item_id TEXT NOT NULL,
 lot_id TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>0),
 status TEXT NOT NULL CHECK(status IN('reserved','consumed','released','manually-settled')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(event_key,item_id,lot_id),
 FOREIGN KEY(item_id,lot_id) REFERENCES credit_lot_allocations(item_id,lot_id)
);
