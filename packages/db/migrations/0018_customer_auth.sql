-- Migration 0018: Customer Auth Overhaul (AUTH-OVERHAUL-PLAN Phase C)
-- Make customers.phone nullable so customers can register with email + password without phone
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;
