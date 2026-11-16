-- Platform audit A10-02: foreign keys and hot lookups that had no index. Expand-only (indexes only, no column or constraint change).
-- audit_logs only grows and is read per store; accounts and memberships are read by user on every sign-in and admin load.
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_created_idx" ON "audit_logs" USING btree ("tenant_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_user_id_idx" ON "accounts" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_user_id_idx" ON "memberships" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_sessions_user_idx" ON "customer_sessions" USING btree ("tenant_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domains_tenant_id_idx" ON "domains" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_tenant_variant_idx" ON "order_items" USING btree ("tenant_id","variant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discount_redemptions_tenant_customer_idx" ON "discount_redemptions" USING btree ("tenant_id","customer_id");
