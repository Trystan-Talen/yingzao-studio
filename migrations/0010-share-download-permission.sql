-- Preserve existing share authorizations. New shares explicitly persist false by default.
ALTER TABLE shares ADD COLUMN allow_original_download INTEGER NOT NULL DEFAULT 1 CHECK(allow_original_download IN (0,1));
