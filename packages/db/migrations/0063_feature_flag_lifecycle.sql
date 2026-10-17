-- Feature flag lifecycle (owner decision 2026-10-17): release flags can be retired ("made permanent") so they stop
-- cluttering the list; long-lived kill switches are protected from retirement. Expand only, all columns additive.
ALTER TABLE "feature_flags" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'release' NOT NULL;
--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "feature_flags" DROP CONSTRAINT IF EXISTS "feature_flags_kind_chk";
--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_kind_chk" CHECK ("kind" in ('release', 'kill_switch'));
--> statement-breakpoint
UPDATE "feature_flags" SET "kind" = 'kill_switch' WHERE "key" IN ('catalog', 'checkout', 'fulfillment');
--> statement-breakpoint
UPDATE "feature_flags" SET "description" = "rules"->>'description' WHERE "description" IS NULL AND "rules" ? 'description';
