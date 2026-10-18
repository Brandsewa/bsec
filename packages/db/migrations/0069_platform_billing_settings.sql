-- Platform billing credentials (ADR-036, supersedes ADR-014 point 1): the platform's own Razorpay account used to charge
-- merchants for their plan. One row, platform-level, no tenant column, no RLS. Secrets are AES-256-GCM encrypted
-- (TENANT_SECRETS_KEY); key ids are not secret. Expand-only (docs/migrations.md).
CREATE TABLE IF NOT EXISTS "platform_billing_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"grace_days" integer DEFAULT 7 NOT NULL,
	"test_key_id" text,
	"test_secret_ciphertext" text,
	"test_secret_iv" text,
	"test_webhook_ciphertext" text,
	"test_webhook_iv" text,
	"live_key_id" text,
	"live_secret_ciphertext" text,
	"live_secret_iv" text,
	"live_webhook_ciphertext" text,
	"live_webhook_iv" text,
	"last_test_at" timestamp with time zone,
	"last_test_status" text,
	"last_test_error" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_billing_settings_single_row" CHECK ("id" = 'default'),
	CONSTRAINT "platform_billing_settings_mode_chk" CHECK ("mode" IN ('test', 'live')),
	CONSTRAINT "platform_billing_settings_grace_chk" CHECK ("grace_days" BETWEEN 0 AND 30)
);
--> statement-breakpoint
-- Only the platform service (app_platform) writes. The self-service role (app_saas: billing webhook and subscribe
-- paths) reads, granted in saas-grants.ts. The store runtime (app_rw) never sees it.
REVOKE ALL ON TABLE "platform_billing_settings" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_billing_settings" FROM "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_billing_settings" TO "app_platform";
