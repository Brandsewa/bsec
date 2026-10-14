-- Migration 0057_media_storage_key_uniq.sql
-- Enforces uniqueness of storage keys per tenant in media table (MEDIA-LIBRARY-PLAN §5.2 / Bug B2 fix).

CREATE UNIQUE INDEX IF NOT EXISTS "media_tenant_storage_key_uniq" ON "media" ("tenant_id", "storage_key");
