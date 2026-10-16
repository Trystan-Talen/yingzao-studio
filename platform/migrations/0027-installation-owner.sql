-- Pin installation authority once. Timestamps and random UUID order are not roles.
CREATE TABLE installation_owner (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 assigned_at TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('legacy-first-row','initial-registration'))
);

-- Existing installations have no immutable setup-role record. Freeze the first
-- remaining stored user (rowid order), not mutable creation timestamps.
INSERT INTO installation_owner(singleton,user_id,assigned_at,source)
SELECT 1,id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'legacy-first-row'
FROM users ORDER BY rowid LIMIT 1;

CREATE TRIGGER assign_initial_installation_owner AFTER INSERT ON users
WHEN NOT EXISTS(SELECT 1 FROM installation_owner)
BEGIN
 INSERT INTO installation_owner(singleton,user_id,assigned_at,source)
 VALUES(1,NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'initial-registration');
END;

CREATE TRIGGER installation_owner_no_update BEFORE UPDATE ON installation_owner
BEGIN
 SELECT RAISE(ABORT,'Installation owner is immutable');
END;
CREATE TRIGGER installation_owner_no_delete BEFORE DELETE ON installation_owner
BEGIN
 SELECT RAISE(ABORT,'Installation owner is immutable');
END;
