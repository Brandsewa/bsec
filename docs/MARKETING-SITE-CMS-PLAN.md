# Marketing site dashboard, page builder and blog

- Status: **Draft for owner review.** Nothing built. Written 2026-11-02.
- Planner and verifier: Claude Code. Builder: assigned by the owner.
- Related: ADR-001 (domain logic), ADR-002 (tenancy and roles), ADR-004 (cache tags), ADR-009 and ADR-010 (blocks, no merchant code), ADR-011 (fallbacks), ADR-033 (blog), `docs/MARKETING-SITE-PLAN.md`, `docs/changes/2026-11-02-claude-marketing-home-redesign.md`.
- A new ADR is written in Phase 0, before any code.

## 1. Goal

A platform owner or admin can sign in to Super Admin and, under Marketing, manage bcom.si: edit marketing pages in the Puck page builder, write blog posts, manage media, menus and SEO, and publish, with no developer and no deploy. Stores, signup and the current look of the site stay as they are. No new hosting.

## 2. What already exists (read from the code)

| Need | Exists today | Where |
|---|---|---|
| Puck page builder | Yes, with drafts, publish and preview | `packages/block-editor`, `apps/admin/src/components/page-editor/` |
| Blog | Yes: posts, categories, schedule, SEO, redirects, RSS, sitemap | ADR-033, `apps/admin/src/routes/_store/online-store/blog*` |
| Media library, menus, pages, leads | Yes, per store | store admin |
| Rendering of a block page | Yes | `packages/blocks`, `apps/web` |
| Marketing page design | Code only, as server components under `.mk` | `apps/web/src/components/marketing/home/` |
| A way to tell the bcom.si host apart | Yes | `apps/web/src/server/hosts.ts` |

All of this is scoped to a tenant. So the shortest path is to make bcom.si's content one internal tenant, not to build a second content system.

## 3. Decision

**A Marketing section inside Super Admin, over one internal "platform site" tenant.** Owner's direction, 2026-11-02.

```
Marketing
  Navigation
  Pages
  Blogs and categories
```

- Only `platform_owner` and `platform_admin` can open Marketing. `platform_support` cannot. No new role (owner decision, 2026-11-02).
- If marketers need access later, they get a separate dashboard, built then. The shared screens from this work make that cheaper. It is out of scope here.
- The content lives in normal tenant tables, through the existing domain services. No new content tables.
- Super Admin already hosts Puck (`TemplateEditor.tsx`), and staff already have MFA and audit logs.

**The one hard constraint.** `apps/platform` connects as `app_platform`, which bypasses RLS. Store services depend on RLS: `listPages` in `content-services.ts` selects from `pages` with no tenant filter. Calling it as-is from the Platform API would return **every store's pages**. So:

- `apps/platform` gets a second, small connection pool as `app_rw`, used only by the Marketing procedures. RLS then applies exactly as it does in the web app, and the services stay unchanged.
- The tenant id is fixed on the server from the `platform_site` row. It is never taken from the request.
- This does not widen any grant, but the Platform service gains the `app_rw` credential, so rule 9 needs the owner's explicit yes and an ADR.

Rejected:
- **Adding tenant filters to every service:** one missed query leaks store data, and nothing would catch it at the database.
- **Separate marketing content tables in Super Admin:** drops the `app_rw` pool and the job exclusions, but duplicates the blog, pages and menus logic. The owner kept the internal record, 2026-11-02.
- **Store admin in a restricted mode:** less code, but a second place to sign in. The owner prefers one dashboard.
- **WordPress:** see the review on 2026-11-02: it needs separate hosting and cannot replace the signup app.

## 4. Design

**Tenant.** Add `tenants.kind` (`store` default, `platform_site`), migration expand only. Exactly one `platform_site` row, enforced by a partial unique index, created by an idempotent script, never by signup.

**Every job and list must skip it.** A normal store would be suspended when its trial ends. These must exclude `platform_site`: trial expiry and billing sweeps, quota checks, Super Admin store lists and metrics, tenant deletion, lifecycle changes, and the demo and retention jobs. Phase 1 lists each one from the code and adds a real-database test.

**Host.** The marketing host maps to this tenant in one server helper. The root layout's marketing branch stays, so the host still gets no store gate, header or footer, and `/signup` and `/api/saas/*` are unchanged. Note: `page.tsx` currently treats "no tenant" as "marketing", so the marketing check must come first and must not depend on that.

**Rendering.** The marketing host renders the tenant's published block page for `/`, `/about`, `/contact`, `/pricing` and any new page. If there is no published page, or reading it fails, it renders today's code components (ADR-011). This keeps the live site safe during rollout and gives an instant rollback: unpublish.

**Marketing blocks.** New blocks in `packages/blocks`, each with schema, view, registration, editor config and tests, using the `.mk` design: hero, included strip, statement, feature grid, steps, tabbed feature, inverted band, pricing, FAQ, final call, document text. They are validated JSON with enumerated props (rule 8).
- Pricing reads live plans and has no editable prices.
- The store-name checker is a fixed part of the hero and final call.
- Mockups are chosen from a fixed list.
- Blocks are offered only on the `platform_site` tenant, and store blocks only on stores.

**Theme.** `home.css` and `<html data-theme>` stay. The Puck preview must load them, so an editor sees both light and dark.

**Blog.** Middleware allows `/blog*`, `/blog/feed.xml` and category pages on the marketing host. Blog templates render inside the marketing frame (`.mk` nav and footer), with a marketing look for the archive and post. The marketing sitemap adds published pages and posts.

**Dashboard.** A Marketing group in the Super Admin sidebar. New `platform.marketing.*` contracts and handlers in `apps/platform/src/app.ts` call the existing services through the `app_rw` pool. The page, blog and menu screens in `apps/admin` (about 3,800 lines) move to a shared package so both apps use one copy, and each app supplies its own API client. Rich text and media pickers come with them; Media has no menu item but is needed to add images.

**Roles.** No role change. Every Marketing procedure uses `requireStaff("platform_admin")`, and the service `ctx` is built on the server with `content.write`. Each mutation writes `platform_audit_logs` (rule 6) as well as the service's `audit_logs`, and invalidations use tenant tags through `cache-invalidation.ts` (rule 5).

**Legal pages.** Terms, Privacy, Refund and Delivery stay in code for now, because payment gateway reviewers compare them and a stray edit is costly. See section 7.

## 5. Phases

| Phase | Work | Done means |
|---|---|---|
| 0 | ADR, confirm section 7 | Owner has answered |
| 1 | `tenants.kind`, creation script, exclusions | Tenant exists locally, every job and list skips it, tests pass |
| 2 | `app_rw` pool, Marketing procedures and sidebar group | An admin sees an empty Marketing group; support does not |
| 3 | Move blog and menu screens to a shared package; Blogs, Categories and Navigation in Super Admin; blog live on bcom.si | First post live on `/blog`; **useful on its own and shippable** |
| 4 | Pages screen, Puck and marketing blocks, starting with About and new landing pages | About can be rebuilt in Puck and matches the code version |
| 5 | Home and Pricing as block pages, with fallback | Live pages edited in Puck, rollback tested |

Phases 1 and 2 touch the most sensitive code. Phase 4 is the largest; the order lets the blog ship first.

## 6. Acceptance criteria

1. Trial, billing, quota, lifecycle and deletion jobs leave the `platform_site` tenant untouched, shown by real-database tests.
2. Marketing procedures return only the `platform_site` tenant's rows when other tenants have data, shown by real-database tests that run through the `app_rw` pool. A test proves the tenant id cannot be set from the request.
3. `platform_support` is refused by every Marketing procedure, shown by a test.
4. `/signup`, `/api/saas/*`, `/api/auth`, webhooks and store hosts behave exactly as before.
5. With no published page, each marketing URL renders the code version. With a failing read, it still renders.
6. A published page matches the current design in light and dark at 375 px and desktop, with no horizontal overflow and no gradients.
7. A published post appears on `/blog`, in the sitemap and in the feed, with title, description, canonical and `Article` data.
8. Publishing shows on the live page without a deploy, and is in `audit_logs` and `platform_audit_logs`.
9. Blocks reject anything outside their schema. No custom code, CSS or HTML is possible.
10. Home stays within agreed page weight, measured before and after.
11. The gate in `AGENTS.md` section 4 passes, including the heavy suite.

## 7. Questions for the owner

1. Approve the Platform service holding the `app_rw` credential (rule 9)?
2. Legal pages stay in code for now?
3. Ship the blog first (phases 1 to 3), then the page builder?

## 8. Risks

- **The internal tenant is treated as a store somewhere we missed.** Mitigated by the Phase 1 list, tests and the fallback.
- **Reading a tenant on every marketing request.** Cached with tenant tags; the fallback covers outages.
- **Client components in blocks** (pricing toggle, tabs, name checker) can grow the store's JS bundle. Marketing blocks must load separately so the product page budget is untouched.
- **Rebuilding pages in Puck can drift from the design.** Fixed section blocks with few options, not free layout.
- **`app_rw` on the Platform service** must be set in Coolify before deploy, which is the owner's call (`AGENTS.md` section 5). Without it, Marketing must fail closed and the rest of Super Admin must keep working.
- **Moving admin screens to a shared package** touches working store screens, so they need a regression pass.
