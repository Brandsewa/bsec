-- Append-only history of platform brand saves (docs/PLATFORM-BRANDING-PLAN.md phase 3). Platform-level, no tenant
-- column, so no tenantTable()/forceRlsSql (same exemption as platform_branding). The last 20 are kept by the app.
CREATE TABLE IF NOT EXISTS "platform_branding_versions" (
  "version" integer PRIMARY KEY NOT NULL,
  "tokens" jsonb NOT NULL,
  "action" text DEFAULT 'update' NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_branding_versions" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_branding_versions" FROM "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_branding_versions" TO "app_platform";
