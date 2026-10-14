ALTER TABLE users ADD COLUMN local_password_enabled INTEGER NOT NULL DEFAULT 1 CHECK(local_password_enabled IN (0,1));
