-- Discount engine, phase 1 (ADR-045). Expand-only: one new column with a default, so existing rows and the running app
-- are unaffected. `rules` carries the extras a discount can have (cap, exclude sale items, once per order, later tiers).
ALTER TABLE "discounts" ADD COLUMN "rules" jsonb DEFAULT '{}'::jsonb NOT NULL;
