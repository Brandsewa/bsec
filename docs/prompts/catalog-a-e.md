# Task: Catalog Phases A to E (indexing, categories, collections, brands, locations, reviews)

You are working in the `bsec` monorepo (pnpm + Turborepo, TypeScript, React 19, Tailwind 4, TanStack Router/Query, oRPC, Drizzle, Next.js storefront, Postgres with row level security). bsec is a multi-tenant commerce SaaS for Indian D2C stores. A mistake can leak one store's data to another, publish pages that should not be indexed, or show fake reviews, so follow the rules exactly.

## What the owner decided
- **Categories are always indexable. There is no switch to turn that off.** **Collections default to not indexable**; an admin can switch indexing on per collection. An **empty** category or collection (no active listed products) is served `noindex, follow` automatically and left out of the sitemap.
- Every product has one **primary category** plus optional extra categories (the product form for that is a later task: **Phase F is not part of this task**).
- **Unlisted** products are reachable by direct link, hidden from every list, search, related block, collection and the sitemap.
- **No brand pages** on the storefront. Brands are a label and a filter.
- Build a **basic review system** (the theme blocks already show stars from `products.rating_avg` and `rating_count`, which nothing writes today).
- Global variants and transfers are **not** part of this task.

## Read first, in this order
1. `AGENTS.md`: the rule book. Sections 2, 4, 5 and 6 apply in full.
2. `docs/PRODUCTS-CATALOG-PLAN.md`: **your spec.** Sections 0 to 3 and **Phases A to E** and section 5 (acceptance criteria). Ignore Phase F.
3. `docs/PRODUCTS-SECTION-FINDINGS.md`: the evidence, and the layout feel of the reference screens.
4. `docs/ORDERS-SECTIONS-OVERVIEW.md` **section 4 "Look and feel", which is mandatory** for every admin screen, plus `docs/admin-ui-standards.md` and `apps/admin/components.json` (shadcn `base-mira` on Base UI, shared kit). Copy patterns (not code) from `apps/admin/src/routes/_store/orders.tsx` for lists, `orders_.new.tsx` for create pages, `settings/orders.tsx` for settings.
5. The code you will change (read it first): `packages/db/src/schema/catalog.ts`, `packages/contracts/src/admin.ts` (categories, collections, brands, inventory sections), `packages/domain/src/catalog-services.ts`, `packages/domain/src/storefront/seo.ts`, `catalog.ts`, `product-status.ts`, `apps/web/src/app/categories/[slug]`, `collections/[slug]`, `products/[slug]`, `sitemap.xml/route.ts`, `robots.txt/route.ts`, `packages/blocks` (how ratings display), `packages/domain/src/cache-invalidation.ts`.
6. `docs/ARCHITECTURE.md` and the newest files in `docs/changes/`.

`Storify/` (if you see it) is another project's code. **Never copy code from it, never import it, never stage it.** Stage files by path; never use `git add -A`. If any file above is missing, **stop and tell me**.

## Rules of engagement
- **Base branch:** the Orders work is a stack of branches ending at `feat/orders-returns` (commit `7a7f49f` or later). Branch from that tip, or from `main` if the stack has been merged; never from older `main`. First step: `git fetch`, create a **new worktree and branch** `feat/catalog-a-e`. If `git status` is not clean, stop and tell me instead of stashing or discarding anything. If the plan docs are not in your tree, tell me.
- **Migrations:** the last existing one is `0023_returns.sql`. Yours start at `0024`, expand-only, appended in order; update the journal. Never edit an applied migration.
- Add one line to "In flight" in `progress.md` before you start; remove it when done.
- Keep everything **local**: commit on your branch, do **not** push, never push to or merge into `main` (a push to `main` that passes CI deploys to production). Never force-push, never `--no-verify`.
- Do not touch Razorpay or Shiprocket. No new dependencies without saying why in the change record.
- Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`. One concern per commit.
- **There is no `switch.tsx` in `apps/admin/src/components/ui` yet.** Add it with the shadcn CLI as the overview describes (watch the `cn` import gotcha), commit it on its own, and use it for every on or off control. Another task (Phase F) may add it too; if it already exists in your base, reuse it.

## Build in this order, one commit group each

### A. Indexing foundations (storefront and domain, no admin UI)
Plan section 3 and Phase A. Migration `collections.indexable boolean not null default false` (existing collections become not indexable; say so in the change record). Make category, collection and product pages use stored `seo.title` and `seo.description` when set (today they are ignored), set the robots meta, canonical and Open Graph as plan section 3 lists, and implement the sitemap rules. Add `DIRECT_PRODUCT_STATUSES` (`active`, `published`, `unlisted`) and `LISTED_PRODUCT_STATUSES` (`active`, `published`) beside `STOREFRONT_PRODUCT_STATUSES` and **audit every use** of the old constant: direct product page and add-to-cart use the first; lists, search, related blocks, collections and the sitemap use the second. The contract and validation accept `unlisted`. Tests, real database where data is involved: robots value for every combination (category, collection indexable or not, empty, filtered or sorted URL, page 2), sitemap contents per state, unlisted never leaking into lists or search, tenant isolation.

### B. Categories admin
`apps/admin/src/routes/_store/categories.tsx`, `categories_.new.tsx`, `categories_.$id.tsx`. Migration `categories.is_active` and `is_featured`. Everything in plan Phase B: stat cards, tabs, tree-aware table with reordering, full-page form with SEO card (live preview and counters), image, parent (3 levels maximum), delete guards. **No indexing control anywhere in the UI or API.** Extend the contract and domain (`products.write` to change, `products.read` to read, `audit_logs`, tenant-prefixed cache tags through `cache-invalidation.ts`).

### C. Collections admin
`collections.tsx`, `collections_.new.tsx`, `collections_.$id.tsx` per plan Phase C: stats, tabs, list with a "Search engines: Indexed or Hidden" column, manual product picker with ordering, automated **condition builder** (reuse the rules schema the storefront already evaluates; validate server-side), sort order, status, and the SEO card with the **"Allow search engines to index this page" switch, off by default**. Skip Storify's "Look" kind.

### D. Brands and Locations admin
Brands: list and small form (name, handle, logo), delete with a usage count. Locations: new contract and domain (none exist), list and form, with the rules in plan Phase D (exactly one default, the default and the last active location cannot be deactivated or deleted, a location holding stock cannot be deleted). No pickup or opening hours. Audited.

### E. Reviews (basic)
Data, storefront and admin exactly as plan Phase E: a `reviews` tenant table (`tenantTable()`, `forceRlsSql`, composite FKs), aggregates (`rating_avg`, `rating_count`) recomputed **in the same transaction** on every publish, hold, edit or delete using published reviews only, plus a backfill; the product-page summary, list (10 per page, newest first) and **Write a review** form; eligibility (signed-in customer or valid order-link holder with a **delivered order containing the product**, one review per product); **plain text only** (escape on output, never render HTML or links), per customer and per IP rate limits, a honeypot; new reviews `on_hold` unless the store setting **Publish reviews automatically** is on (add it next to the order settings, off by default); JSON-LD `AggregateRating` and `Review` for published reviews only; every storefront page keeps `loading.tsx`. Admin `reviews.tsx`: rating summary card, tabs (All, Published, On hold, Replied, Awaiting reply), search, table, row and bulk Publish, Put on hold, Delete (confirm), a Reply dialog (one public reply, 1000 characters). No review photos in this task.

### Navigation
Do **not** restructure the sidebar in this task (Phase F does). Add routes only; if you need the pages reachable, add the minimal items to the existing **Sell** group and say so in your report.

## Non-negotiables (these fail review)
- RLS on every new tenant table; composite tenant foreign keys; migrations append-only and expand-only; no `eslint-disable`; `pendingComponent` on every admin route and `loading.tsx` on every storefront page.
- Contracts first, then domain with `assertPermission`, then handler, then UI. Every mutation writes `audit_logs`. Cache tags are tenant-prefixed. Business logic stays in `packages/domain`; apps parse input, call a service and shape output.
- Public input (reviews) is validated with Zod, rate limited, never trusted, never rendered as HTML.
- New admin UI uses the shared kit and `base-mira` components only: no native `<select>`, no `window.confirm`, no hand-rolled tables; Base UI uses the `render` prop, not `asChild`.
- A setting, switch or button with no behaviour behind it is a bug. Do not ship placeholders.
- Report honestly. Failing or skipped tests are stated with output. Never claim "verified" for something you did not run.

## Definition of done
1. Gate passes, **one package at a time**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, then `pnpm --filter @bs/contracts test`, `pnpm --filter @bs/domain test:fast`, `pnpm --filter @bs/domain test:heavy`, `pnpm --filter @bs/admin test`, `pnpm --filter @bs/web test`, `pnpm --filter @bs/blocks test` if touched.
2. Every acceptance criterion for Phases A to E in `docs/PRODUCTS-CATALOG-PLAN.md` section 5 is checked off in your change record with how you verified it.
3. You ran it in a real browser (desktop and 375 px): create a category tree, a collection (manual and automated), toggle collection indexing and view page source and `/sitemap.xml` before and after, view an empty category, an unlisted product, a filtered URL; submit a review as a customer with a delivered order, see it held, publish it in the admin, see the stars and counts change on the product card; try an ineligible review and a script tag in the text. State what you did not verify.
4. Docs: `docs/ARCHITECTURE.md` updated (tables, routes, jobs, settings; **bump "Last verified" to your commit**), and a change record per phase group named `YYYY-MM-DD-antigravity-catalog-<phase>.md` from `TEMPLATE.md`.
5. Hand back: the commits, test results, anything you could not verify, any question for the owner. Claude will verify against the acceptance criteria before this is called done.
