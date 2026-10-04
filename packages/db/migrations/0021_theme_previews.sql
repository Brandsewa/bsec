-- Theme previews: short-lived shareable snapshots of a theme draft (Super Admin > theme editor > Preview).
-- New table only (expand): older app versions never touch it. The storefront reads it; only the platform writes.
CREATE TABLE IF NOT EXISTS "theme_previews" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "code" text NOT NULL,
  "template_code" text NOT NULL,
  "name" text NOT NULL,
  "pages" jsonb NOT NULL,
  "tokens" jsonb NOT NULL,
  "created_by" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "theme_previews_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "theme_previews_expires_idx" ON "theme_previews" USING btree ("expires_at");
--> statement-breakpoint
-- The web runtime (app_rw) may only read previews; creating and pruning them is the platform's job.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
    REVOKE INSERT, UPDATE, DELETE ON TABLE "theme_previews" FROM app_rw;
  END IF;
END $$;
