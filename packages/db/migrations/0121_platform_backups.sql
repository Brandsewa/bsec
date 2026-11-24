-- Backup monitoring (docs/BACKUP-DR-PLAN.md G10). Expand-only: three new platform tables, nothing existing changes.
-- Policy row, per-run check results written by the worker, and the restore drill log. No tenant data, no RLS.

CREATE TABLE "platform_backup_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"dump_max_age_hours" integer DEFAULT 26 NOT NULL,
	"wal_max_lag_minutes" integer DEFAULT 10 NOT NULL,
	"drill_every_days" integer DEFAULT 35 NOT NULL,
	"wal_archiving_expected" boolean DEFAULT false NOT NULL,
	"alert_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_backup_settings_single_chk" CHECK ("id" = 'default'),
	CONSTRAINT "platform_backup_settings_range_chk" CHECK ("dump_max_age_hours" BETWEEN 1 AND 168 AND "wal_max_lag_minutes" BETWEEN 1 AND 1440 AND "drill_every_days" BETWEEN 7 AND 120)
);
--> statement-breakpoint
CREATE TABLE "platform_backup_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_backup_checks_kind_checked_idx" ON "platform_backup_checks" USING btree ("kind","checked_at");
--> statement-breakpoint
CREATE TABLE "platform_restore_drills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"result" text NOT NULL,
	"drilled_at" timestamp with time zone NOT NULL,
	"rto_seconds" integer,
	"rpo_seconds" integer,
	"notes" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_restore_drills_kind_chk" CHECK ("kind" in ('dump', 'pitr', 'tenant', 'rebuild')),
	CONSTRAINT "platform_restore_drills_result_chk" CHECK ("result" in ('pass', 'fail'))
);
--> statement-breakpoint
CREATE INDEX "platform_restore_drills_drilled_idx" ON "platform_restore_drills" USING btree ("drilled_at");
--> statement-breakpoint
ALTER TABLE "platform_backup_settings" ADD CONSTRAINT "platform_backup_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_restore_drills" ADD CONSTRAINT "platform_restore_drills_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "platform_backup_settings" ("id") VALUES ('default') ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Hard rule 9: default privileges hand app_rw (web and worker) full DML on every new table, so take it back. The policy row
-- and the drill log are written only by the platform service (app_platform, Super Admin); a compromised storefront must not be
-- able to silence backup alerts or forge a passing drill. The worker only reads them. It does write the check results.
REVOKE ALL ON TABLE "platform_backup_settings", "platform_restore_drills", "platform_backup_checks" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_backup_settings", "platform_restore_drills" TO "app_rw";
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "platform_backup_checks" TO "app_rw";
