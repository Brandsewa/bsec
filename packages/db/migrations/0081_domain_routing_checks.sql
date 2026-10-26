-- Custom domains: "connected" must mean "visitors reach us". Cloudflare marks a hostname active after ownership and
-- certificate checks alone, so the platform now also records what the domain's DNS and a real request showed.
-- routing_status: unknown | dns_missing | dns_wrong | dns_ok | reachable. Expand-only.
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "routing_status" text;
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "routing_detail" jsonb;
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "routing_checked_at" timestamp with time zone;
