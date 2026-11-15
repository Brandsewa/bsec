# SEO, GEO and AEO plan for merchant storefronts

- **Date:** 2026-11-15
- **Owner decision needed:** items marked **[owner]**
- **Test store:** `https://ricwell.com` (live, 96 products, 20 categories, 7 pages, 37 blog URLs). Audit was read-only GET requests only.
- **Goal:** every store built on the platform is fully discoverable and citable: by search engines (SEO), by AI answer engines and agents (GEO: generative engine optimisation), and by answer boxes and voice (AEO: answer engine optimisation), without the merchant doing technical work.

## 1. Where we stand (audit of ricwell.com and the code, 2026-11-15)

What already works: tenant-scoped `robots.txt` and `sitemap.xml` that go empty or `Disallow: /` when a store is not live or "hide from search engines" is on; per-page canonical and `noindex` for filtered, sorted and empty listings; Product, BreadcrumbList, ItemList, FAQPage, BlogPosting and Blog schema; RSS feed; 404 status for unknown URLs; `noindex` on cart, search, account and internal pages; blog with full Open Graph, article times and author.

| # | Finding on the live store | Severity | Fixed in this branch |
|---|---|---|---|
| 1 | **Product schema price is 100x too high** (`"price":63700` for a ₹637 product). Variant prices are stored in minor units and were published as is. Google would show or reject wrong prices. | Critical | Yes |
| 2 | Home page title is `Home`, description is `Welcome to our store.`, no canonical, no Open Graph, no Twitter tags. | High | Yes |
| 3 | `robots.txt` blocks GPTBot, ClaudeBot, PerplexityBot, Google-Extended and CCBot by default, so AI answers cannot cite the store. No entry for the search and user agents (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Perplexity-User). | High | Yes (defaults; see 3.1) |
| 4 | An AI bot with its own `robots.txt` group ignores the `*` group, so the old `Allow: /` groups would also have let allowed bots into cart and checkout. | Medium | Yes |
| 5 | `robots.txt` did not cover `/account`, `/search`, `/track`, `/preview/`, `/cod/`, `/address/`, `/o/`, `/privacy-*`, `/unsubscribe/` (all pages with tokens or no search value). | Medium | Yes |
| 6 | No `/llms.txt` (404). | Medium (GEO) | Yes |
| 7 | Policy pages: title `Privacy Policy \| Store Policies` (no store name), generic description, no canonical, and unpublished policies serve the platform's stock text, identical on every store, yet are listed in the sitemap (and 404 when the policies feature flag is on). | High | Yes |
| 8 | Breadcrumb schema on products points at `/products`, which is a 404. Policy breadcrumbs repeat the same URL twice. | Medium | Yes |
| 9 | `/collections` has no H1, no canonical, title `Collections`. | Medium | Partly (title, description, canonical, Open Graph; H1 is theme content, see 4) |
| 10 | Search page description says "mechanical keyboards, accessories and components" (copy left from a demo store). | Low | Yes |
| 11 | Category and product listing images: 12 of 25 `<img>` had an empty `alt` (a saved `""` beat the title fallback). | Medium | Yes (product cards) |
| 12 | Product, category and collection pages had no `og:url` or `og:site_name`; product pages had no Twitter tags. | Low | Yes |
| 13 | Sitemap `<loc>` was not XML-escaped (a slug or prefix with `&` would break the file). | Low | Yes |
| 14 | Home page has no `<h1>` in the HTML on ricwell (theme block content). | Medium | No: theme/content, see 4 |
| 15 | No `favicon.ico` (404), no web manifest, no `og:image` on the home page and listings. | Medium | No, see 4 |
| 16 | Blog category title ends `\| Ricwell \| ricwell` (brand twice). Blog images: 3 of 5 empty alt. | Low | No, see 4 |
| 17 | `robots.txt` is served with `Cache-Control: max-age=31536000` (set by the host framework, not by our route). A change to the indexing switch could take up to a day on Cloudflare (`s-maxage=86400`). | Medium | No, investigate (4) |
| 18 | `http://` answers with a 302, not a 301/308. `www.ricwell.com` does not resolve. | Low | No, infra (4) |
| 19 | The Taste of Hills store (`tasteofhills.bcom.si`) is correctly hidden (`Disallow: /`, `noindex`, empty sitemap), which is the intended behaviour for a store not yet open. | OK | n/a |

## 2. Best practice we are measuring against

Sources: Google Search Central (product structured data, merchant listings, sitemaps, robots, canonicalisation, JavaScript SEO), schema.org, the llmstxt.org proposal, and the documented crawler lists of OpenAI, Anthropic, Perplexity and Google. This was written from those documents as known at the time of writing; re-check a rule against the live Google doc before relying on an edge case.

**SEO (Google, Bing)**
- One canonical, absolute, self-referencing URL per page; filtered, sorted and internal-search URLs `noindex` and canonicalised to the clean page; paginated pages self-canonical.
- Sitemap lists only indexable, 200, canonical URLs with real `lastmod`; referenced from `robots.txt`; `changefreq` and `priority` are ignored by Google (harmless).
- Unique title and meta description per page, title around 50 to 60 characters, store name once.
- Product page: Product + Offer (price as the displayed amount, `priceCurrency`, `availability`, `sku`, `gtin` only when valid), images, `brand`, `aggregateRating` only with real reviews; for merchant listings add `hasMerchantReturnPolicy` and `shippingDetails`.
- BreadcrumbList whose every URL resolves; Organization with logo and `sameAs`; WebSite.
- Descriptive `alt` text, one H1 per page, crawlable links, content in the server-rendered HTML (the storefront is server-rendered, which is already right).
- Do not block `/_next/` assets (Google renders the page).
- Fast, stable pages (Core Web Vitals); a 50 KB product page script budget already exists.

**GEO (AI search and assistants)**
- Let the retrieval agents in (`OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`, `Applebot`); training crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`) are a merchant choice, and blocking them does not remove the store from Google Search.
- Publish `/llms.txt` (a Markdown map of the store) and keep the sitemap complete.
- Clear, quotable facts on the page: price, availability, shipping, returns, who the merchant is. Entities named consistently (Organization, Brand, Product).
- Bing's index feeds ChatGPT search, so Bing Webmaster and IndexNow matter as much as Google.

**AEO (answer boxes, voice)**
- FAQPage only for questions that are visible on the page; HowTo is no longer rewarded by Google, so we do not generate it.
- Question headings and a short direct answer first, then detail (a content rule for the blog and page editors, not code).
- Blog posts carry `BlogPosting` with author, publisher, dates and image.

## 3. What this branch changes (Phase 1)

Code: `packages/domain/src/storefront/seo.ts` (schema, robots, sitemap, home metadata, llms.txt), `apps/web/src/app/llms.txt/route.ts` (new), product, home, policy, collections and search pages, `ProductCard`.

1. Product JSON-LD price is converted with `toMajorUnits(price, currency)` (JPY has no decimals, KWD has three). Adds `@id`, `url`, `sku`, `category`, seller, valid `gtin`, `PreOrder` and `BackOrder` availability, market URL prefix; a price-on-request product publishes no offer.
2. `buildHomeSeoMetadata`: store name as title instead of `Home`, description from the page, then the store default, then a sentence; canonical, Open Graph and Twitter.
3. `robots.txt`: wider private-path list, `Allow: /` for the store, AI crawler defaults changed (3.1), only blocked bots get a group.
4. `/llms.txt` per store, same visibility rules as the sitemap (404 when hidden or not live).
5. Policies: publish-aware metadata (index only the merchant's own published policy; the stock text is `noindex`), sitemap lists only published policies, breadcrumb fixed.
6. Product breadcrumb no longer links `/products` (404). `og:url` and `og:site_name` on products, categories, collections; Twitter card on products.
7. Smaller: search description, `/collections` metadata, product card `alt` fallback, sitemap XML escaping.

### 3.1 [owner] AI crawler defaults

New defaults: allow the six search and user agents, `GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`; block `CCBot` and `Bytespider` (bulk scrapers that send no traffic). Stores that already saved their own switches keep them. **Existing stores:** a store whose row was created with the old defaults (probably including ricwell) would keep blocking the five bots. Migration `0105_seo_reset_old_ai_crawler_defaults` (owner yes, 2026-11-15: "updates should also reflect on existing stores") sets `ai_crawlers` to NULL for every row that still equals the old default exactly, so those stores follow the new default from the next deploy. A row with any other content was edited by a merchant and is left alone. Limit: a merchant who deliberately saved exactly the old five blocks is indistinguishable and is reset too (they can block again in Settings > SEO). The `robots.txt` response is cached up to a day at the CDN, so the change shows within about 24 hours.
The other Phase 1 fixes (price in schema, home and policy metadata, `llms.txt`, sitemap, breadcrumbs) are code, so every store gets them on deploy.

## 4. Phase 2 (in priority order; items marked DONE are in branch `feat/seo-phase2`)

1. After deploy, re-fetch ricwell's `robots.txt` and confirm the five bots are no longer blocked (migration 0105 does the reset, 3.1).
2. **DONE (H1, blog title)** Theme content fixes found on ricwell: home and collections get a visually hidden H1 when no block supplies one; the blog title no longer repeats the store name. Not done: blog image alt text (merchant content), an editor warning for pages with no H1.
3. **DONE** Organization schema: `@id`, logo (Brand settings, else the theme header or footer logo), legal name, contact point from Settings, `sameAs` from the footer's https social icons. `seo_settings.organizationSchema` is still unused.
4. **DONE (branch `feat/seo-phase2b`)** Merchant listings: `hasMerchantReturnPolicy` from Settings > Returns (window days, accept returns, store country), `shippingDetails` from the default zone's rates priced with checkout's own rule engine (read-only: no zone is created, state-limited zones and unknown-weight tiers are left out), and up to five newest published `review`s next to a real rating (`storefront/seo-offers.ts`).
5. **DONE** Default `og:image` and `twitter:image`: SEO default image, else Brand social image, else Brand logo, on the layout and on home, collections, categories, pages and policies (Next replaces `openGraph` per page, so `withShareImage` re-adds it). Products and blog posts keep their own images.
6. **DONE** Favicon and apple touch icon from Brand settings in the page head, and `/manifest.webmanifest` per store (name, valid Brand colours, only the icons the merchant uploaded with their real sizes).
7. **DONE** Image sitemap entries (up to five pictures per product) and hreflang: every page served by two or more markets lists its alternates plus x-default in the sitemap, the home page also in `<head>`; only when every market has a distinct, valid language-region code. Blog index and posts now use the default share image too.
8. **DONE, switched off until the owner sets `INDEXNOW_ENABLED=true` in production (web and worker)** IndexNow: the `seo.indexnow_sweep` job (every 15 minutes) sends each live, indexable store's changed sitemap pages (up to 500) to `api.indexnow.org`; stores are enrolled on the first sweep without sending the catalogue; a failure keeps the watermark. Migration 0107 adds `seo_settings.indexnow_pinged_at`. Key file at `/<key>.txt`, key derived from `TENANT_SECRETS_KEY` and the tenant id. A sweep every 15 minutes (not at publish time) because the worker cannot know which edit changed which URL.
9. Not built: CollectionPage schema (ItemList already exists; Google gives it little value).
10. Infra (needs the owner, Cloudflare): http to https as 301, `www` host, and find why `robots.txt` gets a one-year `max-age`.
11. **Partly DONE** Admin `Settings > SEO health` (`admin.seo.health`): visibility, AI assistants allowed, products without description or picture, pictures without alt text, categories and collections without description, core policies published, share image, favicon, contact details, shipping rates, and the number of sitemap pages. Not built: the Search Console and Bing Webmaster connection (owner setup) and per-page title and description length.
12. Not built: a scheduled crawl of live stores. `pnpm seo:audit <url>` is the manual version and now also checks the return policy and shipping fields, og:image, favicon and Organization schema.

## 5. Acceptance criteria for Phase 1

- [x] Product JSON-LD price equals the displayed price for INR, JPY and KWD (unit tests).
- [x] Home metadata never produces `Home` / `Welcome to our store.`; canonical, Open Graph and Twitter present (unit tests).
- [x] `robots.txt` keeps the private paths out, does not give allowed bots their own group, and blocks only CCBot and Bytespider by default (unit tests).
- [x] `/llms.txt` follows the llmstxt.org shape and respects the sitemap's visibility rules (unit tests for the generator; the route is a copy of the sitemap's access check).
- [x] Sitemap lists only published policies; `<loc>` is XML-escaped.
- [ ] Verified on a real running store in a browser and by `pnpm seo:audit` against a deployed preview: **not done in this session**, see the change record.
- [ ] After deploy: ricwell product price in the schema equals the page, home title is no longer `Home`, `/llms.txt` returns 200.
