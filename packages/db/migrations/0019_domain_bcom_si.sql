-- Migration 0019: platform domain moves from gobs.cloud to bcom.si (hard cutover, nothing live on the old domain).
-- Custom domains can never end in the platform domain (domains/service.ts), so a suffix match only hits platform subdomains.
UPDATE "domains" SET "hostname" = regexp_replace("hostname"::text, '\.?gobs\.cloud$', '.bcom.si') WHERE "hostname"::text LIKE '%.gobs.cloud';
UPDATE "domains" SET "hostname" = 'bcom.si' WHERE "hostname"::text = 'gobs.cloud';
ALTER TABLE "platform_email_settings" ALTER COLUMN "from_email" SET DEFAULT 'no-reply@bcom.si';
UPDATE "platform_email_settings" SET "from_email" = 'no-reply@bcom.si' WHERE "from_email"::text LIKE '%@gobs.cloud';
