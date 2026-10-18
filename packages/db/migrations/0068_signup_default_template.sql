-- Expand-only (docs/migrations.md): which theme template new self-service stores start with. At most one row is flagged.
ALTER TABLE "theme_templates" ADD COLUMN IF NOT EXISTS "is_signup_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "theme_templates_signup_default_one" ON "theme_templates" ("is_signup_default") WHERE "is_signup_default";
