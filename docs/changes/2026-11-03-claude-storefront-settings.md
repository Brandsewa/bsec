# Storefront Settings in Super Admin: visibility, search engines, policies, customer privacy

- **Date:** 2026-11-03
- **Agent:** claude
- **Branch:** `feat/storefront-settings` (not merged yet)
- **Area:** contracts, domain, platform, superadmin, content-admin, admin, web
- **Type:** feature
- **Supersedes:** none

## Summary
Slice S2 of Phase 5 (`docs/MARKETING-SITE-CMS-PLAN.md` section 5a). Super Admin > Storefront > Settings now has four sections like the store admin: Website visibility, Search engines, Policies and Customer privacy. The public website honors them.

## What changed
- The store admin's Storefront, Policies and Customer privacy screens moved to `@bs/content-admin` (`settings/*Screen.tsx`, with `settings-page`, the policy editor and `policy-rich-text`). The store admin keeps thin routes and re-exports. The visibility screen takes `view` (`visibility` or `search`) and `website` (hides the password mode, website wording); policies take `website` (the draft is a generic starter, the built-in text stays live until published).
- Contracts and handlers: `marketing.storefront`, `marketing.policies`, `marketing.customerPrivacy` call the same store services through the `app_rw` runtime. The website context gets `settings.read`, `storefront.manage`, `policies.manage`, `privacy.manage` and the `store_owner` role (ADR-042 update).
- The website's status row: a store with no row reads as coming soon, so setup, or the first visit to Settings, creates the row as live. `getPlatformSiteStatus` reads it for the public site and treats a missing row, password mode or a failed read as live.
- Web: a holding block replaces the content of the plain pages, Home and the blog when the mode is coming soon or maintenance (signup, login and APIs are untouched); `noindex`, `Disallow: /` and an empty sitemap when hidden or not live; a published policy replaces the built-in Terms, Privacy, Refund or Delivery page; the privacy contact, officer name and response time replace the built-in grievance details.

## Decisions and trade-offs
- Maintenance on the website is a holding page with a 200 status and `noindex`, not a 503: the layouts cannot set a status code. The screen says so.
- Password mode is a store feature (needs a store host) and is hidden for the website.
- The status is read once per request on public pages; a failure means live.
- Policies start from a generic store starter. Publishing it would replace the real legal text, so the screen warns and nothing is published until someone does it.

## Verification
See the session's gate output. Real database (`apps/platform/test/marketing.int.test.ts`): the website reads live by default and the first read creates its row; coming soon with a headline, maintenance (owner-only for stores, allowed here), hide from search, a published policy, and the privacy contact all save and read back on the website record; a store's policy is untouched. Driven in headless Chromium against local Platform, Super Admin and web: the four sections load; Coming soon shows the holding block on `/`, `/about`, `/blog`, `/terms` and leaves `/signup` alone; robots says `Disallow: /`; hide from search gives `noindex`; back to live restores everything; a published Terms policy shows on `/terms` with its date; the privacy email shows on `/contact`.

NOT verified: on the live site (nothing deployed yet), the maintenance window scheduling and transition log on the website, the policy editor typed by hand (the draft and publish went through the API), the holding page on a phone, and `Retry-After` (not sent).

## Docs updated
- [x] ADR-042, plan

## Follow-ups and open questions
- S3 to S5 in the plan.
- Publishing a policy replaces the built-in text. The built-in texts (reviewed by payment providers) are code, not copies in the editor, so the first edit starts from a blank starter.

## Definition of done
Not done until merged: see `AGENTS.md` section 7.
