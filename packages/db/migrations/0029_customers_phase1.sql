-- Customers Phase 1 (1B): staff notes timeline replaces the single `customers.note`.
-- Migration 0029 -- Customers Phase 1 notes timeline

-- 1. New tenant table `customer_notes` (staff notes about a customer, author, time ordered).
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notes_tenant_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "customer_notes_body_len_chk" CHECK (char_length("body") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_fk" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_notes_tenant_cust_created_idx" ON "customer_notes" ("tenant_id", "customer_id", "created_at");
--> statement-breakpoint
ALTER TABLE "customer_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_notes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "customer_notes" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 2. Migrate the single `customers.note` into the first note, idempotently.
-- The column stays for this release (expand/contract); it is no longer written or read by the app.
INSERT INTO "customer_notes" ("tenant_id", "customer_id", "author_id", "body", "created_at")
SELECT c."tenant_id", c."id", NULL, c."note", COALESCE(c."updated_at", now())
FROM "customers" c
WHERE c."note" IS NOT NULL AND btrim(c."note") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "customer_notes" n
    WHERE n.tenant_id = c.tenant_id AND n.customer_id = c.id
  );
