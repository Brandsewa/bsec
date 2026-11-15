-- Merchant analytics slice 5 (ADR-047): cookie banner wording and optional GA4 / Meta Pixel ids. Expand-only: one nullable column, null = banner off.
ALTER TABLE "privacy_settings" ADD COLUMN "consent_settings" jsonb;
