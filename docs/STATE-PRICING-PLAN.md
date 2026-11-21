# Apps framework and State Pricing: plan

- **Status:** Draft for owner review (nothing built). Author: Claude, 2026-11-03.
- **Trigger:** an Indian customer needs different product prices per Indian state, detected automatically, with correct checkout.
- **Will need:** ADR-043 (Apps framework) and ADR-044 (State pricing) before code. Neither exists yet.

## 0. Owner decisions (2026-11-03, these override anything below that conflicts)

1. **Price model is per product, per state, plus a default.** For product A the merchant sets a price for state X, a price for state Y, and every other state follows the product's normal (default) price. **No zones, no store-wide or collection scopes, no percent rules in v1.** A rule is `(variant or product, state, price)`; variant-level wins over product-level. Bulk CSV import/export stays. (Sections 4.1 zones/scopes/modes are deferred.)
2. **No MRP guard, no blocked states.** Every state is served; unmatched states get the default price.
3. **Detection: Cloudflare first, then MaxMind GeoLite2-City, India-only extract, as fallback.** The owner is handling MaxMind terms and credit. DB-IP and IP2Location are out unless the benchmark shows a need.
4. **Two modes, an app setting:** *Automatic* (default): detected state sets the price. *Manual*: when the app is on and Manual is selected, a **pincode popup appears as soon as the site loads**; the pincode maps to a state and sets the price. In Automatic mode there is no pincode box.
5. **Price is locked to the detected (or entered) state.** A different shipping address does not reprice. The cart is stamped with the state and checkout uses the stamp.
6. **Pricing: free for now.**
7. **Customer domain:** proxied through Cloudflare if possible (gives `cf-region-code` and the real client IP); if not, MaxMind alone does the detection from the client IP the proxy chain gives us.
8. **Super Admin "Marketplace" section:** list all apps, set visibility (private allowlist or public), **turn an app on or off per store**, and a global kill switch. Store admins see only apps visible to them.

Assumptions I made, to confirm: (a) the manual popup is for human visitors only (never for crawlers, so SEO sees default prices) and can be dismissed, which falls back to the default price; (b) manual mode needs a bundled pincode-to-state table (India Post data, shipped as data, not fetched live); (c) the popup is server-rendered with a native `<dialog>` so the product page JavaScript budget is not touched.

## 1. Decision summary

| Question | Recommendation |
|---|---|
| One-off plugin for this customer, or a marketplace? | **Build a small first-party Apps framework (the "marketplace") and ship State Pricing as its first app.** The customer gets it first through private visibility; opening it to everyone later is one switch. A one-off flag would have to be redone as soon as a second app exists. |
| Third-party developers writing apps like Shopify? | **Not now.** Rule 8 (no merchant-controlled code on our servers) and the tenant isolation model make it a separate, large project (sandboxing, OAuth, webhooks, review). The framework is designed so this can be added later without rewriting first-party apps. |
| How to detect the state automatically? | **Cloudflare visitor location headers as the default guess, never as the authority.** Order of trust: shopper's own choice (pincode or state picker) > saved address of a logged-in shopper > Cloudflare region > the store's default price. At checkout the **shipping address state is the authority** and the cart is repriced if it differs. |
| Where do prices come from? | One server-side pricing function (extends the markets function from ADR-040), recomputed at checkout. Never trusted from the client or the header. |

## 2. What exists today (verified in code)

- **Markets (ADR-040, live):** `market_variant_price(tenant_id, variant_id, price)` in SQL, scoped by the transaction-local setting `app.market_id` that the storefront sets. Used across `packages/domain/src/storefront/catalog.ts` for list, filter, sort and min/max price. Cache loaders take `market` as an argument; tags are tenant-prefixed.
- **Country detection:** `apps/web/src/server/market.ts` reads `cf-ipcountry` only when `cf-ray` is present, and only *suggests* (banner), never switches silently. Same stance applies to states.
- **Feature flags:** `packages/domain/src/features.ts` (`feature_flags` plus `tenant_feature_overrides`). These are *platform-controlled* switches. They are not a merchant-facing install/settings concept, so they are the kill switch for an app, not the app model itself.
- **Not present:** any app/plugin/marketplace concept, any state-level or region-level price, any `cf-region` use. Searched `docs/` and `packages/`; the earlier "marketplace" idea exists only in conversation, not in a plan doc.

## 3. Options for the marketplace and the plugin

| | A. Feature flag per tenant | **B. First-party Apps framework (recommended)** | C. Open third-party app platform |
|---|---|---|---|
| What the customer sees | Nothing; staff flip a flag | "Apps" page in admin: browse, install, configure, uninstall | Same as B plus external developers |
| Cost | Days | ~1 week for the framework, then each app is incremental | Months; security-critical |
| Reuse for the next feature | None | Yes (manifest, install state, settings form, audit, permissions) | Yes |
| Risk | Settings UI and storage re-invented per feature | Low; code is ours and reviewed | High: untrusted code, review process, abuse |
| Fits rule 8 | Yes | Yes (apps are our code, not merchant code) | Needs a new ADR |

Shopify's model for reference: merchants browse an app store and install; apps extend through defined extension points (checkout, pricing functions, admin UI blocks), not by editing core. Do the same in miniature: **named extension points inside `packages/domain`**, not arbitrary hooks.

### 3.1 Framework design (ADR-043)

- **App registry in code** (`packages/apps` or `packages/domain/src/apps/`): each app exports a manifest: `key`, name, description, icon, category, version, `requiredPermissions`, `settingsSchema` (Zod), `extensionPoints` it uses, `pricing` (free for now), `visibility` default.
- **Tables** (all `tenantTable()` plus `forceRlsSql`, composite FKs):
  - `tenant_apps`: `tenant_id`, `app_key`, `status` (installed | disabled), `installed_by`, `installed_at`, `settings jsonb` (validated by the manifest schema, versioned), `settings_version`.
  - Platform table `platform_apps`: catalog row per app with `visibility` (`public` | `private`), `allowed_tenant_ids` for private, `kill_switch`. This is how "only this customer" works today and "everyone" works later, with no code change.
- **Lifecycle:** install (permission `settings.write` family or a new `apps.manage`), configure, disable (data kept), uninstall (settings kept for 30 days, then purged; app data tables are only deleted on an explicit confirmed purge). Every action writes `audit_logs`; every platform visibility change writes `platform_audit_logs` (rule 6).
- **Settings UI is schema-driven:** the app declares fields, the shared admin kit renders them. A bespoke screen is allowed for rich apps (State Pricing needs one for the rule grid) but still lives under `Apps > State Pricing`.
- **Extension points** (the only ways an app changes behaviour): `pricing.resolve`, later `checkout.validate`, `admin.productPanel`. An app is a no-op unless installed, enabled and not kill-switched, resolved in one place `isAppActive(ctx, key)` that wraps `isFeatureEnabled`.
- **Cache:** the "app active" fact and settings are cached under `tenantTag(ctx, "app", key)`; install, uninstall and settings change invalidate via `cache-invalidation.ts` (rule 5).
- **Super Admin:** catalog screen to set visibility, allowlist tenants, kill switch.
- **Isolation suite:** map the new `admin.apps.*` procedures in `packages/domain/test/isolation.int.test.ts` (section 4 of AGENTS.md).

## 4. State Pricing app

### 4.1 Pricing model (ADR-044)

Merchants think in three levels; support exactly these and no more in v1:

1. **State zones:** a named group of states/UTs ("South", "Metro", "North-East") or a single state. The 28 states and 8 UTs come from a seeded reference table keyed by **ISO 3166-2:IN code** (e.g. `MH`, `KA`, `DL`), because that is what Cloudflare returns.
2. **Rules** per zone, with **scope** and **mode**:
   - Scope, most specific wins: **variant** > **product** > **collection** > **store-wide**.
   - Mode: `fixed` (exact price in paise for that variant), `percent` (+/- % of the store price), `amount` (+/- paise). Plus an optional rounding rule (nearest 1, 9, 10 or 99 paise-equivalent, reusing the market rounding helper).
3. **Default:** no rule matched means the normal store price. A store can also mark states as **not served** (hide add to cart, show a message). This is optional and off by default.

Rules:
- Money stays integer minor units (ADR-040 section 2). The function is pure and unit-tested: `resolvePrice(base, rules, state) -> {price, ruleId | null}`.
- Applies **inside the India market** (markets whose countries include IN). It layers on top of the market price; it never changes currency. Other markets are untouched.
- **Discounts and coupons apply after** the state price. **GST is not part of the state price rule**: tax is computed by the existing tax rules on the final price, and intra/inter-state treatment follows the destination as today. Keep price and tax strictly separate.
- Merchant-facing editor: zone list, rule table (shared `data-table`), bulk CSV import/export for large catalogs (same worker path as product bulk import), and a **"Preview as state"** selector to see the storefront price for any state.

New tenant tables (rule 1): `state_price_zones`, `state_price_zone_states`, `state_price_rules` (scope columns, mode, value, rounding, priority), all with `tenantForeignKey`. Reference table `platform_in_states` (platform-level, seeded, read-only). Migration is expand-only (rule 10).

SQL: add `region_variant_price(tenant_id, variant_id, price, region_code)` alongside `market_variant_price`, read from a transaction-local `app.price_region` set by the storefront the same way `app.market_id` is. **Inert when empty**, exactly like ADR-040, so every store without the app behaves as today. One function, used by catalog, cart and checkout, so the three can never disagree.

### 4.2 Automatic state detection (the part you asked to explore)

> Superseded where it conflicts: the summary row and the pincode and checkout wording elsewhere in this file predate the 2026-11-03 owner decision below. Automatic detection is primary; the shopper pincode box is an optional merchant setting, off by default; checkout price basis is question 7.

**Cloudflare option (use it).** The managed transform **"Add visitor location headers"** (Rules > Transform Rules > Managed Transforms) adds `cf-region` (name) and **`cf-region-code`** (ISO 3166-2 subdivision code, e.g. `MH`) along with `cf-ipcity`, `cf-postal-code`, `cf-ipcountry`, to every request sent to the origin. Cloudflare's reference page lists no plan restriction for it (Bot Management headers are the Enterprise-only ones). Costs nothing extra and no per-request lookup on our side; it is what the WordPress plugin used. Reference: Cloudflare docs, Managed Transforms reference.

Alternatives considered:

| Option | Verdict |
|---|---|
| Cloudflare headers | **Primary.** Zero latency, no database to maintain, same infrastructure we already trust for `cf-ipcountry`. Needs the transform switched on for each store's zone (custom domains are on the merchant's own Cloudflare or our proxy: confirm which zone applies, see open question 3). |
| MaxMind GeoLite2 / IP2Location LITE, self-hosted | Fallback for stores not behind our Cloudflare. Licence and attribution obligations, monthly database refresh job, memory. Defer; build only if the customer is not on Cloudflare. |
| Browser Geolocation API | Prompts the shopper, often denied, needs JS on the product page whose budget has no headroom. **No.** |
| Pincode entry (Amazon, Flipkart, Myntra pattern) | **Required as the correction path**, not the guess. Seed an India Post pincode-to-state table; a pincode box in the header sets the state cookie and also feeds delivery checks. |
| Shipping address state at checkout | **The authority.** Always. |

**Accuracy caveat to tell the customer plainly:** IP geolocation in India is state-accurate only part of the time. Mobile carriers (Jio, Airtel) route through regional gateways, and VPNs, corporate networks and Google/Apple relay can resolve to the wrong state. Hence the order of trust and the always-visible "Delivering to: Maharashtra (change)" control. Because of that, the detected state is a **default**, and a wrong guess costs one click, not a wrong order.

**Owner decision 2026-11-03:** automatic detection is the primary and default mode. The shopper-facing pincode box / state picker is a **merchant setting, off by default** ("Let shoppers change their delivery state"), because the store owner does not want shoppers changing the price by typing another pincode.

**Detection providers** (behind one `RegionProvider` interface so they can be swapped or chained):

| Provider | Fit |
|---|---|
| Cloudflare `cf-region-code` | Primary. Free, no database. |
| DB-IP IP-to-City Lite (<https://db-ip.com/db/download/ip-to-city-lite>) | Fallback / cross-check. CC BY 4.0, monthly MMDB (~121 MB), has a state name field (needs mapping to ISO codes). DB-IP's own accuracy index is 77 vs 96 for its paid edition. **Attribution:** a link back to db-ip.com on pages that use the results, which a customer's storefront will not want; the paid edition needs none. |
| IP2Location LITE (<https://lite.ip2location.com/>) | Same role. Free for commercial use with attribution; the vendor calls the accuracy "limited"; update cadence not stated on the page. |
| Paid DB-IP / IP2Location, or Cloudflare Enterprise | Only if the benchmark below shows free sources are not good enough. |

**MaxMind GeoLite2-City via the `wp-statistics/GeoLite2-City` mirror** (<https://github.com/wp-statistics/GeoLite2-City>): a gzipped MMDB (~68 MB), rebuilt from MaxMind data every Tuesday and Friday, served from jsDelivr / npm `geolite2-city`. Technically convenient, but:
- **Licence conflict to resolve before use.** The mirror says CC BY-SA 4.0 with MaxMind attribution; MaxMind's own GeoLite EULA requires a MaxMind account, forbids disclosing the data to third parties without consent, requires credit ("This product includes GeoLite Data created by MaxMind") and requires deleting old versions within 30 days of a new release. A third-party mirror cannot change MaxMind's terms. **Download from MaxMind directly** (free account plus `geoipupdate`) and keep this mirror out of the build. Share-alike also matters if we publish a derived India file (see below). Needs the owner's yes and, ideally, a legal read.
- MaxMind says GeoLite is reliable only to postal-code level and gives no accuracy guarantee; no state-level accuracy figure for India is published.
- The mirror's README lists country, city, coordinates, timezone. MaxMind's GeoLite2-City schema also carries the first-level subdivision with its ISO code (the Indian state, e.g. `MH`), which is what we need; **confirm in the benchmark** by reading real records.

**India-only extract: possible.** An MMDB is a searchable tree of networks; a build job can walk every network, keep those whose country is `IN`, and write a new MMDB holding only the state code (and optionally city). Expected result: a file a fraction of 68 MB (not measured; needs the real file), faster to load, and lookups for non-India IPs simply return nothing, which is already our "normal price" fallback. Tooling: MaxMind's reader to iterate plus their MMDB writer (Perl/Go; there are Node ports), run in the worker or CI weekly. Honest limits: the saving is operational, not accuracy (the data inside is identical); MMDB is memory-mapped so 68 MB is not a real problem on its own; and the extract is a derivative database, so MaxMind's terms and attribution apply, and it must stay on our servers, not in the public repo (the repo is public, rule 5 of section 5).

Free LITE databases are the *less* precise tiers of those vendors, and none of the three is documented as state-accurate for Indian mobile networks. Do not assume the extra databases beat Cloudflare: **benchmark first** (Phase 6): collect a few thousand real storefront visits with known states (logged-in default addresses, completed orders), compare Cloudflare vs DB-IP vs IP2Location per state, and pick the chain from data. Self-hosted databases add a monthly refresh job and a memory cost, and are only worth it if they measurably win.

**Resolution order** (new `resolveRegion` next to `getMarketContext`):
1. Cloudflare `cf-region-code`, when `cf-ipcountry` is `IN` and `cf-ray` is present, mapped through the state table.
2. Fallback provider (DB-IP/IP2Location) if Cloudflare gave no region and the provider is enabled.
3. None: the store's normal price (never guess).
4. Only if the merchant enabled the manual option: a signed cookie from the shopper's pincode/state choice overrides 1-3.

**Checkout price basis (merchant setting, needs owner confirmation, question 7):**
- *Locked to detected state (default)*: the price follows the state stamped on the cart; typing a different address does not change it. Matches the owner's intent, but a wrongly detected shopper (VPN, mobile carrier) pays the wrong state's price with no way to correct it.
- *Follows shipping address*: reprice at checkout from the address state. Fairer on mistakes, but it is exactly the loophole the owner wants closed.

**Header trust:** reading the headers only when `cf-ray` is present matches the existing country code but is spoofable if the origin is reachable directly. Spoofing only changes which state price is *displayed*; checkout re-derives from the address, so there is no money exposure. Still, recommend locking origin to Cloudflare (Authenticated Origin Pulls or IP allowlist) in the hardening plan.

### 4.3 Storefront behaviour and SEO

- **PDP, listing, search, cart** show the price for the resolved state. The cart is **stamped with the state** by the server (like the market), never taken from a client field.
- **Checkout:** when the shipping address state differs from the cart's stamped state, the server reprices, shows "Prices updated for Karnataka", and requires the shopper to see the new total before paying. Order stores `price_region`, the rule ids used and the price per line (snapshot), so disputes can be answered.
- **Caching:** a priced page is cacheable per state, 36 values at most. Pass `region` as an argument of the cached loaders, only for stores with the app active, so other stores keep their current cache keys (rule 5; add a test that two regions never share a price). **Edge cache:** do not cache storefront HTML at Cloudflare across regions unless the cache key includes the region (custom cache keys on headers are a higher-plan feature). Safest v1: for stores with the app active, HTML is `private`/not edge-cached and the region price is rendered server side; measure TTFB before deciding more.
- **SEO and structured data:** crawlers come from US IPs. They must get the **default** price and matching JSON-LD, and the visible price must match the structured data they see. Never serve bots a state price and never redirect on location. This avoids a mismatch that Google treats as a feed/price violation.
- **JS budget:** the state picker must be server-rendered with a native form/popover; no new client JS on the product page (50 KB gz limit has no headroom, see memory note on the budget).

### 4.4 Compliance flags (for the owner, not legal advice)

- **Legal Metrology / MRP:** selling above the printed MRP is an offence in India. State prices for packaged goods must not exceed the MRP. Provide an optional `mrp` check: if a rule produces a price above the variant's compare-at/MRP field, block saving and show why. Ask the customer whether their products are MRP-bound.
- Showing different prices by location is normal in India (freight, local taxes, distributor zones), but the merchant should state the policy. Add a storefront-visible, merchant-editable note (e.g. "Prices vary by delivery state").
- No payment or shipping integration is touched (rule 14).

## 5. Phases and acceptance criteria

| Phase | Scope | Done when |
|---|---|---|
| 0 | ADR-043, ADR-044, change record, claim in `progress.md` | Owner approves this plan |
| 1 | Apps framework: tables, registry, install/disable/uninstall, settings storage, `isAppActive`, admin "Apps" page, Super Admin catalog with private visibility and allowlist, audit, isolation mapping | A private demo app can be installed by an allowlisted tenant only; other tenants do not see it; real-DB tests for RLS and visibility; gate green |
| 2 | State reference table, zones and rules schema, pure resolver, SQL `region_variant_price`, unit tests for every scope/mode/rounding/priority case | Resolver tests pass; app inactive means byte-identical results to today (regression test over catalog queries) |
| 3 | Admin editor (zones, rules, bulk CSV, preview-as-state, MRP guard) | Walk-through at 375 px and desktop; audit rows written |
| 4 | Storefront: `resolveRegion`, pincode box, cart stamping, listing/PDP/search pricing, cache keys, bot default | Real-DB tests: price per state in catalog, cart and order; two regions never share a cache entry; bot request gets default price |
| 5 | Checkout reprice on address state change, order snapshot, finance/invoice unaffected, e2e | Test: cart at MH price, address KA, total recomputed server-side; tampered client price rejected |
| 6 | Enable Cloudflare transform on the customer's zone, staging smoke test with real headers, then enable for the customer | Verified on staging first; production enable needs the owner's explicit yes |
| 7 | Open to all (flip visibility to public), docs, ARCHITECTURE.md update | Owner decision |

Per AGENTS.md, every phase needs: gate green, change record, ARCHITECTURE.md trigger table updated (new tables, env, routes), honest status of what was run.

## 6. Open questions for the owner

1. Does the customer need **states as zones** (grouped) or per-state prices on every product? (Plan supports both; changes the editor emphasis.)
2. Are their products **MRP-bound**? Decides whether the MRP guard is mandatory.
3. Is the customer's domain proxied through **Cloudflare**, and whose account/zone? The managed transform must be on for that zone; for our own `bcom.si` subdomains we control it.
4. Should unserved states be blockable (hide buying) in v1?
5. Apps pricing: free for now, but should the manifest reserve a per-app price/plan gate for later?
7. Checkout price basis when the shipping address state differs from the detected state: locked to detected (default proposed) or follows the address? And should a mismatch be allowed to proceed, be blocked, or be flagged on the order for staff review?
8. Confirm the reading of "pincode box should be manual": a merchant toggle, off by default. If it should be removed entirely, say so.
6. Is a single app visibility allowlist enough to start, or do you want Super Admin to approve install requests from other stores?

## 7. Sources

- Cloudflare Managed Transforms reference, "Add visitor location headers" (cf-region, cf-region-code, cf-ipcity, cf-postal-code): <https://developers.cloudflare.com/rules/transform/managed-transforms/reference/>
- ADR-040 (markets) and `docs/MULTIMARKET-PLAN.md` in this repo.
- Not verified here: exact `cf-region-code` values for every Indian state/UT (e.g. Telangana, Ladakh, merged Dadra/Daman) and real-world accuracy on Indian mobile networks. Phase 6 must test against real traffic before the customer relies on it.
