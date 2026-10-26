# Custom domain routing plan: "connected" must mean "reachable"

- **Date:** 2026-10-26
- **Author:** claude
- **Status:** approved 2026-10-26 with the recommended answers; built on `feat/custom-domain-routing` (see `docs/changes/2026-10-26-claude-custom-domain-routing.md`)
- **Builds on:** ADR-017, `docs/changes/2026-10-19-claude-custom-domain-setup.md`, `DEPLOYMENT.md` "Custom domains"

## 1. What went wrong (darjeelinghoney.com, 2026-10-26)

The merchant chose TXT pre-validation, added the TXT records, and Cloudflare reported the custom hostname **Active** with SSL issued. The platform then showed "Active / SSL active". But the bare domain had **no A, AAAA or CNAME record**, so it did not resolve and the site never opened. Adding an A record to a Cloudflare proxy IP fixed it.

Root causes in the code:
1. `provider.ts` maps Cloudflare `status: active` straight to our `active`. For TXT pre-validation, Cloudflare marks the hostname active on ownership + certificate alone; it does not check that traffic reaches us.
2. With TXT pre-validation the UI shows the TXT record but only a CNAME as the routing record, and a CNAME is impossible on a bare domain (`domains.tsx` only says so in a paragraph). There is no instruction for the A record at all.
3. Nothing ever looks at the domain's real DNS or makes a real request.
4. The first TXT record shown is the ownership one; the `_acme-challenge` TXT/CNAME DCV record is not shown (known gap in the 2026-10-19 record).

## 2. Decision on "the exact IP"

Cloudflare for SaaS on our plan gives **no dedicated or guaranteed IP** (dedicated/BYOIP is Enterprise, see DEPLOYMENT.md). The proxied IPs of `stores.bcom.si` (today `104.21.59.175`, `172.67.182.4`, plus two IPv6) are shared anycast addresses that are stable in practice but not contractual. So:

- **Never hardcode IPs.** Resolve the fallback origin's A/AAAA records at runtime (DNS lookup of `CUSTOM_DOMAIN_CNAME_TARGET`, cached about 10 minutes) and show those in the instructions.
- Optional override `CUSTOM_DOMAIN_A_TARGETS` (comma list) if the owner wants to pin them; if unset, use the live lookup.
- Show **all** returned A records (tell the merchant to add both) and the AAAA records as optional.
- Recommend `www` (CNAME) as the primary path; bare-domain A records are the documented fallback.
- Drift protection: the routing check (section 3) catches a domain whose A record went stale, and the sweep keeps checking active domains daily.

## 3. Design: separate "certificate ready" from "traffic reaches us"

New per-domain routing state, independent of the Cloudflare status. A domain is `active` only when **both** pass.

### 3.1 DNS check (`packages/domain/src/domains/dns-check.ts`)
`checkDomainDns(hostname)` using `node:dns/promises` against a public resolver (1.1.1.1 / 8.8.8.8, not the container's resolver):
- Resolve A, AAAA, CNAME of the hostname.
- `ok` if CNAME chain ends at the fallback origin, or any A/AAAA lies in the live fallback-origin address set, or in Cloudflare's published ranges (any Cloudflare proxy IP routes by Host/SNI to the custom hostname).
- Otherwise a typed reason the UI can explain: `no_records`, `points_elsewhere` (with the IPs seen, e.g. a parking page), `cname_at_apex_unsupported`, `ipv6_only_mismatch`.

### 3.2 HTTP probe (the definitive check)
The web app serves `GET /.well-known/bsec-domain` (public, no tenant data): returns `{ "host": "<Host header>", "resolved": true|false }` and a header `x-bsec-domain: <domains.id>` when the host maps to a store. The worker fetches `https://<hostname>/.well-known/bsec-domain` (short timeout, no redirects followed to other hosts) and confirms the id matches. This proves DNS + Cloudflare + Traefik + the app host resolver all work. SSRF care: only the merchant's own validated hostname is fetched, public IPs only (reject private/loopback results), 5 s timeout, response size capped, no redirects.

### 3.3 State machine
Keep existing statuses; add `routing_status` (`unknown | dns_missing | dns_wrong | dns_ok | reachable`) and `routing_detail` (jsonb: seen records, reason, lastCheckedAt) on `domains`.
- Cloudflare active + routing not `reachable` -> status stays **`awaiting_dns`**, SSL badge can show active, UI says "Certificate ready, waiting for your DNS record".
- `reachable` + Cloudflare active -> `active`.
- A previously `active` domain that fails the routing check 3 daily sweeps in a row -> status `degraded` (banner in admin, audit row, no automatic removal, never leaves primary pointing nowhere silently: keep primary but warn).
- "Make primary" stays gated on `active`, which now implies reachable.

### 3.4 Sweep
Extend `sweepPendingCustomDomains`: pending domains get DNS check every 5 min and the HTTP probe only after DNS passes; `active` domains get a daily re-check. "Check status" runs the same code on demand and returns the routing detail so the toast can say exactly what is missing.

## 4. Design: instructions that match the merchant's situation

The Add flow stops being "CNAME + optional TXT". After the hostname is entered we classify it:
- **Subdomain** (`shop.brand.com`, `www.brand.com`): one record, `CNAME <name> -> stores.bcom.si`.
- **Bare/apex** (`brand.com`): show `A @ -> <live IP 1>`, `A @ -> <live IP 2>` (and optional AAAA), or ALIAS/ANAME/flattening if their DNS host supports it. Also offer: "or connect `www.brand.com` and forward the bare domain".
- **TXT pre-validation** (optional, for zero-downtime): shown as a separate "Step 1: prove ownership" block with BOTH Cloudflare TXT records (ownership and `_acme-challenge`/DCV), followed by "Step 2: point your domain to us" with the A/CNAME. The UI labels step 2 as required even after step 1 passes, so TXT never looks like the whole job.
- Each step shows live status from the checks: `Step 1 done`, `Step 2: we see no A record for darjeelinghoney.com` / `we see it points to 84.32.x.x (not us)` / `done`.
- Existing-records warning generated from the DNS check ("a parking A record exists, remove it") instead of a generic paragraph.
- Copy buttons for every name/value; provider-agnostic wording; no mention of internal hostnames beyond `stores.bcom.si`.

## 5. Contract and API
`packages/contracts`: extend `CustomDomainItem` with `routing: { status, reason?, seen?: {a: string[], cname?: string}, expected: {cname: string, a: string[], aaaa: string[]} }`, and `verification.dcv` (the `_acme-challenge` record). Add no new procedure; `domains.verify` returns the same item. Map nothing new in `isolation.int.test.ts` unless a procedure is added.
Migration (append-only, expand only): add `routing_status text`, `routing_detail jsonb`, `routing_checked_at timestamptz` to `domains` (tenant table already, RLS unchanged); `forceRlsSql` not needed (no new table).

## 6. Work breakdown
1. `dns-check.ts` + unit tests (fake resolver): apex with no records, parking IP, correct A, correct CNAME, IPv6-only.
2. `/.well-known/bsec-domain` route in `apps/web` + host-resolver reuse; test that an unknown host returns `resolved:false` and never another store's data.
3. HTTP probe with SSRF guards + tests.
4. Migration + service changes (`verifyDomainWithDb`, sweep, `degraded`) + **real-Postgres** tests in `custom-domains.int.test.ts` (Cloudflare active but DNS missing stays `awaiting_dns`; both ok becomes `active`; audit rows written).
5. Provider: also return the DCV record; resolve fallback origin IPs at runtime with cache.
6. Admin UI: two-step instructions, per-step status, apex vs subdomain variants, `degraded` banner; update `domains-settings.test.tsx`; update e2e selectors if any text changes.
7. Docs: ADR-017 update, ARCHITECTURE (routes, jobs, tables), DEPLOYMENT.md (new optional env, probe route, apex guidance), change record, `progress.md` in-flight line.

## 7. Acceptance criteria
- A hostname with a passing Cloudflare hostname but no DNS record to us is **never** shown as Active; the UI names the missing record.
- Apex hostnames show A records taken from a live lookup of `stores.bcom.si`; no IP literal exists in source.
- A domain becomes Active only after the HTTP probe returns its own domain id.
- Re-pointing DNS away later is detected within a day and shown as a warning.
- Real-database tests above pass; gate in AGENTS.md section 4 green; admin page walked in a browser at 375 px and desktop.

## 8. Open questions for the owner
- Accept "shared Cloudflare IPs, resolved live" as the answer to "exact IP"? A truly fixed IP needs Cloudflare Enterprise/BYOIP.
- Should a `degraded` domain notify the merchant by email (email delivery is not live yet), or admin banner only?
- Pin `www` as the recommended default in the UI copy, with apex as the advanced option?
