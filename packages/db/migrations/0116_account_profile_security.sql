-- Account and Profile (docs/ACCOUNTS-PROFILE-PLAN.md, phase 1). Expand-only: nullable columns and two new global tables.
-- Staff profile preferences. NULL means "use the default" (browser timezone, English, 12h clock, store dashboard).
ALTER TABLE "users" ADD COLUMN "job_title" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "date_format" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "time_format" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_landing" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ui_density" text;
--> statement-breakpoint
-- What happened to a person's sign-in security (password changed, authenticator on/off, session revoked, sign-in).
-- Global (a staff user spans stores) so no RLS; append-only for the runtime role.
CREATE TABLE "security_events" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "ip" text,
  "user_agent" text,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "security_events_user_created_idx" ON "security_events" USING btree ("user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "security_events" FROM "app_rw";
--> statement-breakpoint
-- Alerts a person has switched off for themselves. A person can only mute an alert their store routes to them, never add one.
CREATE TABLE "user_notification_mutes" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "event_key")
);
