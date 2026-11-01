-- Plan editor (docs/PLANS-AND-PRICING-STRATEGY.md). Expand-only: new nullable/defaulted columns on plans, one new platform table, seed copy.
ALTER TABLE "plans" ADD COLUMN "tagline" text;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "audience" text;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "badge" text;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "card_bullets" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE "plan_compare_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"group_name" text NOT NULL,
	"label" text NOT NULL,
	"tooltip" text,
	"limit_key" text,
	"cells" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
UPDATE "plans" SET "tagline" = 'Launch your brand', "audience" = 'New brands and solo founders', "badge" = NULL, "card_bullets" = '[{"t": "Online store with themes and page builder"}, {"t": "COD, UPI and cards through your own gateway, 0% platform fee"}, {"t": "GST invoices and PIN code serviceability"}, {"t": "Up to {value} products", "k": "products"}, {"t": "{value} staff accounts", "k": "staff_seats"}, {"t": "Sell in your home market"}]'::jsonb WHERE "code" = 'starter';
--> statement-breakpoint
UPDATE "plans" SET "tagline" = 'Sell worldwide without per-order fees', "audience" = 'Growing brands with a small team', "badge" = 'Most popular', "card_bullets" = '[{"t": "Everything in Starter"}, {"t": "Up to {value} products", "k": "products"}, {"t": "{value} staff accounts", "k": "staff_seats"}, {"t": "Sell worldwide: {value} extra markets", "k": "max_extra_markets"}, {"t": "Remove Brand Sewa branding"}, {"t": "Customer segments and custom product fields"}, {"t": "Priority email support"}]'::jsonb WHERE "code" = 'growth';
--> statement-breakpoint
UPDATE "plans" SET "tagline" = 'Run several markets at scale', "audience" = 'Established brands selling in more than one market', "badge" = NULL, "card_bullets" = '[{"t": "Everything in Growth"}, {"t": "Up to {value} products", "k": "products"}, {"t": "{value} staff accounts", "k": "staff_seats"}, {"t": "{value} extra markets", "k": "max_extra_markets"}, {"t": "{value} custom domains", "k": "custom_domains"}, {"t": "Chat support and an onboarding call"}]'::jsonb WHERE "code" = 'pro';
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Core store','Themes and page builder',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,10);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Core store','Products, variants and collections',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,20);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Core store','Blog and unlimited pages',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,30);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Core store','Discounts and promotions',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,40);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Core store','Customer accounts',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,50);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Core store','Product bulk import and export',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,60);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Core store','SEO basics: sitemap, meta tags, redirects',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,70);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('India operations','Cash on delivery',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,80);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('India operations','PIN code serviceability and shipping rates',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,90);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('India operations','GST engine and tax invoices',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,100);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('India operations','Returns and credit notes',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,110);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('India operations','Abandoned checkout recovery',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,120);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('India operations','Order tracking page',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,130);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Selling worldwide','Extra selling markets','max_extra_markets','{}'::jsonb,140);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Selling worldwide','Per-market currency, prices, shipping and tax',NULL,'{"starter": {"k": "none"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,150);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Selling worldwide','Market URLs with hreflang',NULL,'{"starter": {"k": "none"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,160);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Selling worldwide','PayPal, Stripe and Razorpay on your own account',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,170);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Growth tools','Customer segments',NULL,'{"starter": {"k": "none"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,180);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Growth tools','Custom product fields',NULL,'{"starter": {"k": "none"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,190);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Growth tools','Notification manager and email templates',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,200);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Growth tools','Staff roles and permissions',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,210);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Growth tools','Activity log',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,220);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Limits','Products','products','{}'::jsonb,230);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Limits','Variants','variants','{}'::jsonb,240);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Limits','Staff accounts','staff_seats','{}'::jsonb,250);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Limits','Emails per month','emails_month','{}'::jsonb,260);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Limits','Media storage','storage_mb','{}'::jsonb,270);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Limits','Custom domains','custom_domains','{}'::jsonb,280);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Brand and domain','Remove Brand Sewa branding',NULL,'{"starter": {"k": "none"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,290);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Brand and domain','Free SSL on every domain',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,300);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Support','Help centre',NULL,'{"starter": {"k": "tick"}, "growth": {"k": "tick"}, "pro": {"k": "tick"}}'::jsonb,310);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Support','Email support',NULL,'{"starter": {"k": "text", "t": "Standard"}, "growth": {"k": "text", "t": "Priority"}, "pro": {"k": "text", "t": "Priority"}}'::jsonb,320);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Support','Chat support',NULL,'{"starter": {"k": "none"}, "growth": {"k": "none"}, "pro": {"k": "tick"}}'::jsonb,330);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Support','Onboarding call',NULL,'{"starter": {"k": "none"}, "growth": {"k": "none"}, "pro": {"k": "tick"}}'::jsonb,340);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Coming soon','Agent-ready product feed and llms.txt',NULL,'{"starter": {"k": "soon"}, "growth": {"k": "soon"}, "pro": {"k": "soon"}}'::jsonb,350);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Coming soon','AI shopping agent protocols (UCP, ACP)',NULL,'{"starter": {"k": "none"}, "growth": {"k": "soon"}, "pro": {"k": "soon"}}'::jsonb,360);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Coming soon','Store API and MCP access for your own AI agents',NULL,'{"starter": {"k": "none"}, "growth": {"k": "none"}, "pro": {"k": "soon"}}'::jsonb,370);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Coming soon','WhatsApp order confirmation and COD-to-prepaid nudges',NULL,'{"starter": {"k": "none"}, "growth": {"k": "soon"}, "pro": {"k": "soon"}}'::jsonb,380);
--> statement-breakpoint
INSERT INTO "plan_compare_rows" ("group_name","label","limit_key","cells","sort") VALUES ('Coming soon','COD OTP verification and risk flags',NULL,'{"starter": {"k": "none"}, "growth": {"k": "soon"}, "pro": {"k": "soon"}}'::jsonb,390);

--> statement-breakpoint
-- New tables give app_rw full DML by default privileges; the compare table is platform-owned, so the store runtime may only read it.
REVOKE ALL ON TABLE "plan_compare_rows" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "plan_compare_rows" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "plan_compare_rows" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "plan_compare_rows" TO "app_platform";
