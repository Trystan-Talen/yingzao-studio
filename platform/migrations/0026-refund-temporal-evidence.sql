CREATE TABLE billing_refund_collections(
 provider_id TEXT NOT NULL,
 charge_id TEXT NOT NULL,
 payment_intent_id TEXT,
 order_id TEXT REFERENCES orders(id),
 complete INTEGER NOT NULL CHECK(complete IN(0,1)),
 observed_at TEXT NOT NULL,
 PRIMARY KEY(provider_id,charge_id)
);
CREATE TABLE billing_refund_facts(
 provider_id TEXT NOT NULL,
 refund_id TEXT NOT NULL,
 charge_id TEXT NOT NULL,
 payment_intent_id TEXT,
 order_id TEXT REFERENCES orders(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 currency TEXT NOT NULL,
 refund_created_at TEXT NOT NULL,
 status TEXT NOT NULL,
 first_succeeded_observed_at TEXT,
 observed_at TEXT NOT NULL,
 PRIMARY KEY(provider_id,refund_id)
);
CREATE INDEX billing_refund_facts_order ON billing_refund_facts(order_id,refund_created_at);
