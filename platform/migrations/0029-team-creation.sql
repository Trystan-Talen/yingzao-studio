-- Team purchase reservations have no membership until verified fulfillment.
CREATE TABLE team_account_slots (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 origin TEXT NOT NULL CHECK(origin IN ('legacy','created','ownership')),
 created_at TEXT NOT NULL
);
INSERT INTO team_account_slots(user_id,workspace_id,origin,created_at)
SELECT u.id,
 (SELECT w.id FROM workspaces w WHERE w.kind='team' AND
  (w.created_by=u.id OR EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=w.id AND m.user_id=u.id AND m.role='owner'))
  ORDER BY w.created_at,w.id LIMIT 1),
 'legacy',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM users u WHERE EXISTS(SELECT 1 FROM workspaces w WHERE w.kind='team' AND
 (w.created_by=u.id OR EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=w.id AND m.user_id=u.id AND m.role='owner')));
CREATE TABLE team_provisioning (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 state TEXT NOT NULL CHECK(state IN ('pending','active')),
 order_id TEXT REFERENCES orders(id),
 created_at TEXT NOT NULL,
 activated_at TEXT
);
CREATE TRIGGER team_creator_slot AFTER INSERT ON workspaces WHEN NEW.kind='team'
BEGIN
 INSERT OR IGNORE INTO team_account_slots VALUES(NEW.created_by,NEW.id,'created',NEW.created_at);
END;
CREATE TRIGGER team_slot_no_delete BEFORE DELETE ON team_account_slots
BEGIN SELECT RAISE(ABORT,'Team creation slot cannot be reset'); END;
CREATE TRIGGER team_slot_no_update BEFORE UPDATE ON team_account_slots
BEGIN SELECT RAISE(ABORT,'Team creation slot is immutable'); END;
