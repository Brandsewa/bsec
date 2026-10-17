-- Audit log archiving (owner decision 2026-10-17): audit rows are never deleted or edited. Archiving only records that
-- a row was hidden from the default view, in a separate insert/delete-only table, so platform_audit_logs stays append-only.
CREATE TABLE IF NOT EXISTS "platform_audit_log_archives" (
	"audit_log_id" uuid PRIMARY KEY NOT NULL,
	"archived_by" uuid,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_audit_log_archives" ADD CONSTRAINT "platform_audit_log_archives_log_fk" FOREIGN KEY ("audit_log_id") REFERENCES "platform_audit_logs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Platform-only: take back the default privileges app_rw would otherwise get on every new table.
REVOKE ALL ON TABLE "platform_audit_log_archives" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "platform_audit_log_archives" TO "app_platform";
