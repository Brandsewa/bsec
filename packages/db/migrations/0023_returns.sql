ALTER TABLE "products" ADD COLUMN "returnable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "requested_resolution" text;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "customer_comment" text;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "exchange_request" text;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "decision_message" text;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "instructions_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "refund_method" text;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "refund_reference" text;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "refund_amount" integer;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "refunded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "exchange_note" text;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "exchange_order_id" uuid;
--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_exchange_order_fk" FOREIGN KEY ("tenant_id","exchange_order_id") REFERENCES "orders"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "intent_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "method" text;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reference" text;
--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "return_settings" jsonb;
