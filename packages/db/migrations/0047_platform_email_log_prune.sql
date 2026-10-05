-- The worker's 90-day retention prune (prunePlatformEmailLogs) runs as app_rw and was refused: app_rw only had
-- INSERT on platform_email_log, so retention of recipient addresses never ran. Grant the least needed: DELETE, and
-- SELECT on just the two columns the prune reads (id for RETURNING, created_at for the cutoff), not the recipients.
GRANT DELETE ON TABLE "platform_email_log" TO "app_rw";
--> statement-breakpoint
GRANT SELECT ("id", "created_at") ON TABLE "platform_email_log" TO "app_rw";
