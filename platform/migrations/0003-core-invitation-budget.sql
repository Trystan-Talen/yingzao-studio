ALTER TABLE invitations ADD COLUMN credit_limit INTEGER CHECK(credit_limit IS NULL OR credit_limit >= 0);
