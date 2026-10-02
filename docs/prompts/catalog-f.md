# Task: Catalog Phase F (product form, Catalog sidebar group, Unlisted, primary category, inventory columns)

You are working in the `bsec` monorepo (pnpm + Turborepo, TypeScript, React 19, Tailwind 4, TanStack Router/Query, oRPC, Drizzle, Next.js storefront, Postgres with row level security). A mistake can leak one store's data to another or hide products from shoppers, so follow the rules exactly.

## What the owner decided
- Every product has **one primary category** (required to publish) plus optional extra categories; collections are optional and many to many.
- **Unlisted** products are reachable by direct link and hidden from lists, search, related blocks, collections and the sitemap.
- The product form moves to the two-column layout with **Organization**, **Search Engine Listing** (live preview) and **Status** cards. Skip barcode standards, HS code, 3D models, the POS channel and any SEO "score".
- **Price on request** and the per-variant **pre-order** controls already exist on the form (built in the Orders work). **Keep them.**

## Prerequisite
This task builds on **Catalog Phases A to E** (`docs/prompts/catalog-a-e.md`): the category, collection, brand, location and review screens, the `unlisted` status support and the `DIRECT_PRODUCT_STATUSES` and `LISTED_PRODUCT_STATUSES` split. Start only when that work is on your base branch. If the base does not contain the categories and collections admin screens or `LISTED_PRODUCT_STATUSES`, **stop and tell me**.

## Read first, in this order
1. `AGENTS.md`: sections 2, 4, 5 and 6 apply in full.
2. `docs/PRODUCTS-CATALOG-PLAN.md`: **Phase F** is your spec, plus section 0 (decisions) and section 5 (acceptance criteria).
3. `docs/PRODUCTS-SECTION-FINDINGS.md` section 1 (the layout of the reference product form).
4. `docs/ORDERS-SECTIONS-OVERVIEW.md` **section 4 "Look and feel" (mandatory)**, `docs/admin-ui-standards.md`, `apps/admin/components.json`.
5. The code you will change (read first): `apps/admin/src/routes/_store/products/$id.tsx`, `new.tsx`, `index.tsx`; `apps/admin/src/routes/_store.tsx` (sidebar); `apps/admin/src/routes/_store/inventory/index.tsx`; `packages/contracts/src/admin.ts` (products, inventory); `packages/domain/src/catalog-services.ts`; `packages/db/src/schema/catalog.ts`; `packages/domain/src/orders/manual-lifecycle.ts` (how `products.returnable` is enforced).
6. `docs/ARCHITECTURE.md` and the newest files in `docs/changes/`.

`Storify/` (if you see it) is another project's code: **never copy code from it, never import it, never stage it.** Stage files by path; never `git add -A`. If any file above is missing, **stop and tell me**.

## Rules of engagement
- First step: `git fetch`, then a **new worktree and branch** `feat/catalog-f` from the tip that contains Phases A to E. If `git status` is not clean, stop and tell me instead of stashing or discarding anything.
- Migrations: continue the existing numbering (check the highest file in `packages/db/migrations`), expand-only, never edit an applied one.
- Add one line to "In flight" in `progress.md`; remove it when done.
- Keep everything **local**: commit on your branch, do **not** push, never push to or merge into `main`. Never force-push, never `--no-verify`.
- Do not touch Razorpay or Shiprocket. Commit trailer: `Co-Authored-By: Antigravity <noreply@google.com>`. One concern per commit.

## Build in this order, one commit group each

### 1. Data and domain
- `product_categories.is_primary boolean not null default false` with a partial unique index `(tenant_id, product_id) where is_primary` (one primary per product). Backfill: the earliest-position row per product becomes primary.
- Product contract, create and update: `primaryCategoryId`, `extraCategoryIds`, `collectionIds`, `brandId`, `tags`, `status` including `unlisted`, `seo` (title, description, handle), `featured`, and **`returnable`** (the flag is enforced by the server in `manual-lifecycle.ts` today but **nothing can set it**; fix that). Keep every field the Orders work added (`priceOnRequest`, per-variant `preorderEnabled`, `preorderShipsOn`, `preorderMessage`); do not rename or remove them.
- **Rule:** a product cannot move to Active or Unlisted without a primary category. Grandfather products that are already active until their next status change, with a clear error message. Save categories and collections through `product_categories` and `collection_products` in one transaction with the product. `assertPermission(ctx, "products.write")`, `audit_logs`, tenant-prefixed cache invalidation (`cache-invalidation.ts`).
- Storefront breadcrumbs and structured data use the primary category.

### 2. Switch component
There is **no `switch.tsx`** in `apps/admin/src/components/ui` (an earlier task was asked to add one and did not). If your base still lacks it, add it with the shadcn CLI per the overview (gotchas: it writes `import { cn } from "cn"` and adds an unrelated `cn` package: fix the import to `@/lib/utils` and remove the package). Replace the checkboxes used for on and off controls in the product form (Price on request, pre-order enable, Requires shipping where it is an on or off setting) with it. Do not change what they do.

### 3. Product form, two columns (`$id.tsx` and `new.tsx`)
Sticky header: title, status badge, Save, Back. **Left column**, stacked cards: **Details** (title, handle, short description, description), **Media**, **Pricing** (price, compare-at, **Price on request** switch), **Variants** (existing per-variant fields and the existing **pre-order block**, kept as is), **Inventory**, **Shipping**, **Search Engine Listing** (live Google-style preview with the store name and URL, title counter 70, description counter 160, editable handle, blank means auto-filled from title and excerpt). **Right rail**: **Status** (Draft, Active, **Unlisted**, Archived, plus Featured), **Organization** (**Primary category, required to publish**, extra categories, brand, collections, tags), and **Returns** (the **Returnable** switch, on by default, labelled "Final sale" when off). The creation page and the edit page share the same components; mobile stacks the rail under the main column. Use `SectionCard`, `Field`, `SimpleSelect`, and the unsaved-changes guard. Category and collection pickers are searchable multi-selects built from the kit; the primary category is a single select from the same list.

### 4. Sidebar and list
In `apps/admin/src/routes/_store.tsx` add a **Catalog** group (Products, Categories, Collections, Brands, Inventory, Locations, Reviews), moving Products and Inventory out of **Sell**, which keeps Customers and Discounts. Add an item only for a page that exists; keep each item's permission (`products.read`). In the products list add the Unlisted status to the tabs, filter and badges, keep the existing "Pre-order" and "Pre-order date passed" badges, and show the primary category column.

### 5. Inventory polish
Add **Committed** (`reserved`) and **Available** columns and a **location filter** (shown only when the store has two or more locations) to the Inventory page. Do not remove the existing adjust flow or reasons.

## Non-negotiables (these fail review)
- RLS intact; migrations append-only and expand-only; no `eslint-disable`; `pendingComponent` on every admin route.
- Contracts first, then domain with `assertPermission`, then handler, then UI. Every mutation writes `audit_logs`. Cache tags are tenant-prefixed.
- Nothing the Orders work added may regress: price on request still blocks add to cart, pre-order dates still snapshot at checkout, `returnable = false` still blocks the return form (add a test that exercises the new switch end to end).
- New UI uses the shared kit and `base-mira` components only: no native `<select>`, no `window.confirm`, no hand-rolled controls; Base UI uses the `render` prop, not `asChild`.
- Report honestly; failing or skipped tests are stated with output. Never claim "verified" for something you did not run.

## Definition of done
1. Gate passes, **one package at a time**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, then `pnpm --filter @bs/contracts test`, `pnpm --filter @bs/domain test:fast`, `pnpm --filter @bs/domain test:heavy`, `pnpm --filter @bs/admin test`, `pnpm --filter @bs/web test`.
2. Every Phase F criterion in `docs/PRODUCTS-CATALOG-PLAN.md` section 5 is checked off in your change record with how you verified it.
3. You ran it in a real browser (desktop and 375 px): create a product with a primary category, extra categories, brand and collections; try to publish without a primary category (refused); set Unlisted and confirm the direct link works while lists, search and the sitemap exclude it; turn Returnable off and confirm the customer return form no longer offers it; edit a product with the existing pre-order and price-on-request settings and confirm they still save; check the Catalog sidebar group, the inventory columns, and the SEO preview. State what you did not verify.
4. Docs: `docs/ARCHITECTURE.md` updated (bump "Last verified" to your commit); a change record `YYYY-MM-DD-antigravity-catalog-f.md` from `TEMPLATE.md`.
5. Hand back: the commits, test results, anything you could not verify, any question for the owner. Claude will verify against the acceptance criteria before this is called done.
