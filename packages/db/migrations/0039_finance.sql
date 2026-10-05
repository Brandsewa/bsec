-- Expand order_items with nullable cost_price snapshot
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_price" bigint;
--> statement-breakpoint
-- 1. Double-entry ledger entries table
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"book" text DEFAULT 'own' NOT NULL,
	"debit" text NOT NULL,
	"credit" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid,
	"source_ref" text,
	"key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_entries_tenant_key_uniq" UNIQUE("tenant_id","key"),
	CONSTRAINT "ledger_entries_amount_positive" CHECK (amount > 0),
	CONSTRAINT "ledger_entries_debit_ne_credit" CHECK (debit <> credit),
	CONSTRAINT "ledger_entries_note_length" CHECK (note IS NULL OR length(note) <= 500)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_book_date_idx" ON "ledger_entries" ("tenant_id","book","date");
--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_debit_date_idx" ON "ledger_entries" ("tenant_id","debit","date");
--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_credit_date_idx" ON "ledger_entries" ("tenant_id","credit","date");
--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_source_idx" ON "ledger_entries" ("tenant_id","source_kind","source_id");
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ledger_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ledger_entries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ledger_entries" TO "app_rw", "app_platform";
--> statement-breakpoint
-- 2. Store expenses table
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"description" text NOT NULL,
	"payee" text,
	"paid_from" text DEFAULT 'bank' NOT NULL,
	"receipt_media_id" uuid,
	"settlement" jsonb,
	"settlement_sequence" integer DEFAULT 0 NOT NULL,
	"recurring" jsonb,
	"template_id" uuid,
	"note" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"debit_account" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "expenses_amount_non_negative" CHECK (amount >= 0),
	CONSTRAINT "expenses_description_length" CHECK (length(description) >= 2 AND length(description) <= 300),
	CONSTRAINT "expenses_payee_length" CHECK (payee IS NULL OR length(payee) <= 200),
	CONSTRAINT "expenses_note_length" CHECK (note IS NULL OR length(note) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_media_fk" FOREIGN KEY ("tenant_id","receipt_media_id") REFERENCES "media"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "expenses_tenant_date_idx" ON "expenses" ("tenant_id","date" DESC);
--> statement-breakpoint
CREATE INDEX "expenses_tenant_category_date_idx" ON "expenses" ("tenant_id","category","date");
--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_tenant_template_date_uniq" ON "expenses" ("tenant_id","template_id","date") WHERE template_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "expenses" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "expenses" TO "app_rw", "app_platform";
--> statement-breakpoint
-- 3. Fiscal periods table
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"label" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_periods_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fiscal_periods_tenant_label_uniq" UNIQUE("tenant_id","label"),
	CONSTRAINT "fiscal_periods_note_length" CHECK (note IS NULL OR length(note) <= 500)
);
--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "fiscal_periods_tenant_period_to_idx" ON "fiscal_periods" ("tenant_id","period_to" DESC);
--> statement-breakpoint
ALTER TABLE "fiscal_periods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fiscal_periods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_periods" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "fiscal_periods" TO "app_rw", "app_platform";
