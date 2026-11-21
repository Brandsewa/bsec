-- A store can pin an installed app to the admin sidebar (ADR-043). Expand-only: one new column with a default.
ALTER TABLE "tenant_apps" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;
