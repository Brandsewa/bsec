-- Migration 0053: Platform payment providers (ADMIN-IMPROVEMENTS-PLAN Phase 4 slice D, §6.4)
-- Platform-level, NO tenant column, writable only by app_platform, read-only by app_rw, NO RLS.
CREATE TABLE IF NOT EXISTS "platform_payment_providers" (
  "provider" text PRIMARY KEY NOT NULL,
  "display_name" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "live_mode_allowed" boolean DEFAULT false NOT NULL,
  "sort" integer DEFAULT 0 NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Razorpay stays enabled so stores that already manage Razorpay keys see no change; Stripe starts disabled.
INSERT INTO "platform_payment_providers" ("provider", "display_name", "enabled", "live_mode_allowed", "sort")
VALUES
  ('razorpay', 'Razorpay', true, false, 1),
  ('stripe', 'Stripe', false, false, 2)
ON CONFLICT ("provider") DO NOTHING;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_payment_providers" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_payment_providers" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_payment_providers" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_payment_providers" TO "app_platform";
--> statement-breakpoint
-- Stores can now hold a Stripe payment method row next to COD and Razorpay (expand: widen the allowed values).
ALTER TABLE "payment_methods" DROP CONSTRAINT IF EXISTS "payment_methods_provider_chk";
--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_provider_chk" CHECK ("provider" IN ('cod', 'razorpay', 'stripe'));
