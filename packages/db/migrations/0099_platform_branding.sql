-- Platform branding (single row, id = 'default'): the BCom platform's own logos, favicon, colours and buttons
-- (docs/PLATFORM-BRANDING-PLAN.md). Platform-level data, no tenant column, so no tenantTable()/forceRlsSql
-- (same exemption as platform_settings). Created EMPTY on purpose: absence means the built-in defaults.
CREATE TABLE IF NOT EXISTS "platform_branding" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_branding" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_branding" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_branding" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_branding" TO "app_platform";
